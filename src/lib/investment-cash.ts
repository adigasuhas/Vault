import type { InvestmentCashEntryType } from "@prisma/client";
import { db } from "@/lib/db";
import { ValidationError, roundMoney } from "@/lib/validate";
import { audit, postInvestmentCashMove, reverseInvestmentCashMove, type Tx } from "@/lib/ledger";
import { dateOnly, todayIn } from "@/lib/dates";
import { claimRequest, lostRace, requestSeen, settleRequest } from "@/lib/request-keys";

/**
 * Investment cash: money realised from investment sales, or added from an
 * account, that waits to be reinvested or withdrawn. One balance per
 * currency, defined as the sum of the user's InvestmentCashEntry rows in it.
 *
 * Invariants (mirroring the account ledger in lib/ledger):
 *  - entries are never edited or deleted; undo is a REVERSAL entry that
 *    carries the opposite effect and stamps the original's `reversedAt`;
 *  - no balance goes below zero: every entry that takes money out checks the
 *    balance under a per-user lock, in the same transaction that writes it;
 *  - a move to or from an account is two entries written together, one here
 *    and one in the account ledger, so money is neither created nor lost;
 *  - a tracking-only sale writes nothing here.
 */

const EPS = 0.005;

/** Effect of an entry on its currency's balance. */
export function cashSigned(type: InvestmentCashEntryType | string, amount: number) {
  if (type === "REVERSAL") return amount;
  return type === "PURCHASE" || type === "TO_ACCOUNT" ? -amount : amount;
}

/** Serialises everything that reads and then changes a user's investment
 * cash, so two requests can't both spend the same balance. Held until the
 * transaction ends; taking it again in the same transaction is a no-op. */
export async function lockCash(tx: Tx, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`investment-cash:${userId}`}))`;
}

export async function cashBalance(tx: Tx | typeof db, userId: string, currency: string) {
  const sums = await tx.investmentCashEntry.groupBy({ by: ["type"], where: { userId, currency }, _sum: { amount: true } });
  return roundMoney(sums.reduce((t, s) => t + cashSigned(s.type, Number(s._sum.amount ?? 0)), 0));
}

/** Every currency the user has held investment cash in, with its balance. */
export async function cashBalances(userId: string, tx: Tx | typeof db = db) {
  const sums = await tx.investmentCashEntry.groupBy({ by: ["currency", "type"], where: { userId }, _sum: { amount: true } });
  const by = new Map<string, number>();
  for (const s of sums) by.set(s.currency, (by.get(s.currency) ?? 0) + cashSigned(s.type, Number(s._sum.amount ?? 0)));
  return [...by.entries()].map(([currency, balance]) => ({ currency, balance: roundMoney(balance) })).sort((a, b) => b.balance - a.balance);
}

function shortBy(balance: number, amount: number, currency: string) {
  return `Investment cash has ${balance.toFixed(2)} ${currency}; this needs ${amount.toFixed(2)}.`;
}

async function assertNotFuture(tx: Tx, userId: string, date: Date) {
  const owner = await tx.user.findUnique({ where: { id: userId }, select: { timezone: true } });
  if (dateOnly(date) > todayIn(owner?.timezone || "UTC")) {
    throw new ValidationError("That date is in the future. Record it on or after the day the money moves.");
  }
}

export interface CashPost {
  currency: string;
  type: Exclude<InvestmentCashEntryType, "REVERSAL">;
  amount: number;
  date: Date;
  description: string;
  saleId?: string;
  investmentRef?: string;
  ledgerEntryId?: string;
  /** Message when the balance can't cover a debit. */
  insufficient?: (balance: number) => string;
}

/** Writes one entry. Debits are checked against the balance first. */
export async function postCash(tx: Tx, userId: string, p: CashPost) {
  const amount = roundMoney(p.amount);
  if (!(amount > 0)) throw new ValidationError("The amount has to be more than zero.");
  await assertNotFuture(tx, userId, p.date);
  await lockCash(tx, userId);
  if (cashSigned(p.type, amount) < 0) {
    const balance = await cashBalance(tx, userId, p.currency);
    if (balance - amount < -EPS) throw new ValidationError(p.insufficient ? p.insufficient(balance) : shortBy(balance, amount, p.currency));
  }
  return tx.investmentCashEntry.create({
    data: {
      userId,
      currency: p.currency,
      type: p.type,
      amount,
      date: dateOnly(p.date),
      description: p.description,
      saleId: p.saleId,
      investmentRef: p.investmentRef,
      ledgerEntryId: p.ledgerEntryId,
    },
  });
}

/** Cancels an entry with an equal and opposite REVERSAL, dated today (or
 * the original's date, if later). Reversing money that came in must leave
 * enough behind. */
export async function reverseCash(tx: Tx, userId: string, entryId: string, description: string, insufficient?: (balance: number, needed: number) => string) {
  await lockCash(tx, userId);
  const entry = await tx.investmentCashEntry.findFirst({ where: { id: entryId, userId } });
  if (!entry) throw new ValidationError("That investment cash entry wasn't found.");
  if (entry.reversedAt) throw new ValidationError("This was already undone.");
  if (entry.type === "REVERSAL") throw new ValidationError("An undo can't itself be undone.");
  const effect = cashSigned(entry.type, Number(entry.amount));
  if (effect > 0) {
    const balance = await cashBalance(tx, userId, entry.currency);
    if (balance - effect < -EPS) {
      throw new ValidationError(insufficient ? insufficient(balance, effect) : `Only ${balance.toFixed(2)} ${entry.currency} is left in investment cash; undoing this takes ${effect.toFixed(2)}.`);
    }
  }
  const now = new Date();
  const day = dateOnly(now);
  const reversal = await tx.investmentCashEntry.create({
    data: {
      userId,
      currency: entry.currency,
      type: "REVERSAL",
      amount: -effect,
      date: day > entry.date ? day : entry.date,
      description,
      saleId: entry.saleId,
      investmentRef: entry.investmentRef,
      reversalOfId: entry.id,
    },
  });
  await tx.investmentCashEntry.update({ where: { id: entry.id }, data: { reversedAt: now } });
  return reversal;
}

// ------------------------------------------------------------- account moves

export interface MoveInput {
  accountId: string;
  /** Investment cash currency. Defaults to the account's. */
  currency?: string;
  /** Leaving the source, in its currency: the account for a top-up, investment cash for a withdrawal. */
  amount: number;
  /** Arriving at the destination, when the currencies differ. */
  arrivedAmount?: number;
  date: Date;
  note?: string;
  idempotencyKey?: string;
}

type MoveResult = { entry: Awaited<ReturnType<typeof postCash>>; duplicate: boolean };

async function replay(userId: string, resultId: string | null): Promise<MoveResult> {
  const entry = resultId ? await db.investmentCashEntry.findFirst({ where: { id: resultId, userId } }) : null;
  if (!entry) throw new ValidationError("This request was already received and is still being saved. Refresh in a moment.");
  return { entry, duplicate: true };
}

async function once(userId: string, key: string | undefined, scope: string, run: (tx: Tx) => Promise<Awaited<ReturnType<typeof postCash>>>): Promise<MoveResult> {
  const seen = await requestSeen(userId, key);
  if (seen) return replay(userId, seen.resultId);
  try {
    const entry = await db.$transaction(async (tx: Tx) => {
      await claimRequest(tx, userId, key, scope);
      const e = await run(tx);
      await settleRequest(tx, userId, key, e.id);
      return e;
    });
    return { entry, duplicate: false };
  } catch (e) {
    const won = await lostRace(e, userId, key);
    if (won) return replay(userId, won.resultId);
    throw e;
  }
}

async function accountFor(tx: Tx, userId: string, accountId: string) {
  // Same lock order as transfers: the account row, then investment cash.
  await tx.$executeRaw`SELECT id FROM "Account" WHERE id = ${accountId} AND "userId" = ${userId} FOR UPDATE`;
  const account = await tx.account.findFirst({ where: { id: accountId, userId } });
  if (!account) throw new ValidationError("Account not found.");
  if (account.status === "CLOSED") throw new ValidationError(`${account.name} is closed. Pick an open account.`);
  return account;
}

function arriving(input: MoveInput, from: string, to: string, toName: string) {
  if (from === to) return roundMoney(input.amount);
  if (!(input.arrivedAmount && input.arrivedAmount > 0)) throw new ValidationError(`${toName} is in ${to}. Enter the ${to} amount that arrives.`);
  return roundMoney(input.arrivedAmount);
}

/** Adds money from an account to investment cash: a deliberate move, never
 * automatic. The account must hold the amount (credit cards: within limit). */
export async function addFromAccount(userId: string, input: MoveInput) {
  return once(userId, input.idempotencyKey, "CASH_IN", async (tx) => {
    const account = await accountFor(tx, userId, input.accountId);
    const currency = input.currency ?? account.currency;
    const arrives = arriving(input, account.currency, currency, "Investment cash");
    const label = `To investment cash${input.note ? ` · ${input.note}` : ""}`;
    const out = await postInvestmentCashMove(tx, userId, { accountId: account.id, type: "TO_INVESTMENT_CASH", amount: roundMoney(input.amount), date: input.date, description: label });
    const entry = await postCash(tx, userId, { currency, type: "FROM_ACCOUNT", amount: arrives, date: input.date, description: `From ${account.name}${input.note ? ` · ${input.note}` : ""}`, ledgerEntryId: out.id });
    await audit(tx, userId, "InvestmentCash", entry.id, "CASH_IN", `${arrives} ${currency} added to investment cash from ${account.name}`);
    return entry;
  });
}

/** Withdraws investment cash to an account, all of it or part. */
export async function withdrawToAccount(userId: string, input: MoveInput) {
  return once(userId, input.idempotencyKey, "CASH_OUT", async (tx) => {
    const account = await accountFor(tx, userId, input.accountId);
    const currency = input.currency || account.currency;
    const arrives = arriving(input, currency, account.currency, account.name);
    const into = await postInvestmentCashMove(tx, userId, { accountId: account.id, type: "FROM_INVESTMENT_CASH", amount: arrives, date: input.date, description: `From investment cash${input.note ? ` · ${input.note}` : ""}` });
    const entry = await postCash(tx, userId, {
      currency,
      type: "TO_ACCOUNT",
      amount: input.amount,
      date: input.date,
      description: `To ${account.name}${input.note ? ` · ${input.note}` : ""}`,
      ledgerEntryId: into.id,
      insufficient: (b) => `You can withdraw up to ${b.toFixed(2)} ${currency}.`,
    });
    await audit(tx, userId, "InvestmentCash", entry.id, "CASH_OUT", `${roundMoney(input.amount)} ${currency} withdrawn from investment cash to ${account.name}`);
    return entry;
  });
}

/** Undoes a move between an account and investment cash: both sides are
 * reversed together, each checked so neither balance goes negative. */
export async function undoMove(userId: string, entryId: string) {
  return db.$transaction(async (tx: Tx) => {
    const entry = await tx.investmentCashEntry.findFirst({ where: { id: entryId, userId }, include: { ledgerEntry: { include: { account: true } } } });
    if (!entry) throw new ValidationError("That move wasn't found.");
    if (entry.type !== "FROM_ACCOUNT" && entry.type !== "TO_ACCOUNT") throw new ValidationError("Only moves to and from accounts can be undone here.");
    if (entry.reversedAt) throw new ValidationError("This move was already undone.");
    const name = entry.ledgerEntry?.account?.name ?? "the account";
    if (entry.ledgerEntryId) {
      await tx.$executeRaw`SELECT id FROM "Account" WHERE id = ${entry.ledgerEntry!.accountId} FOR UPDATE`;
      await reverseInvestmentCashMove(tx, userId, entry.ledgerEntryId, `Undo: ${entry.type === "FROM_ACCOUNT" ? "to" : "from"} investment cash`);
    }
    const reversal = await reverseCash(tx, userId, entry.id, `Undo: ${entry.type === "FROM_ACCOUNT" ? `from ${name}` : `to ${name}`}`, (b, n) =>
      `Only ${b.toFixed(2)} ${entry.currency} is left in investment cash, and undoing this takes ${n.toFixed(2)}. Some of it has been reinvested or withdrawn.`
    );
    await audit(tx, userId, "InvestmentCash", entry.id, "UNDO_MOVE", `Undid ${entry.type === "FROM_ACCOUNT" ? "money added from" : "withdrawal to"} ${name}`);
    return reversal;
  });
}

// ------------------------------------------------------------------- history

export interface CashRow {
  id: string;
  type: InvestmentCashEntryType;
  currency: string;
  amount: number;
  date: string;
  description: string | null;
  /** The sale, account or purchase on the other side. */
  sale: { id: string; name: string } | null;
  account: { id: string; name: string; currency: string; amount: number } | null;
  investmentRef: string | null;
  reversedAt: string | null;
  reversalOfId: string | null;
  createdAt: string;
}

/** Every movement, newest first, with what was on the other side. */
export async function cashHistory(userId: string, opts: { currency?: string; take?: number } = {}): Promise<CashRow[]> {
  const rows = await db.investmentCashEntry.findMany({
    where: { userId, ...(opts.currency ? { currency: opts.currency } : {}) },
    include: { sale: { select: { id: true, name: true } }, ledgerEntry: { select: { amount: true, currency: true, account: { select: { id: true, name: true } } } } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: opts.take ?? 500,
  });
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    currency: r.currency,
    amount: roundMoney(cashSigned(r.type, Number(r.amount))),
    date: r.date.toISOString(),
    description: r.description,
    sale: r.sale,
    account: r.ledgerEntry?.account ? { ...r.ledgerEntry.account, currency: r.ledgerEntry.currency, amount: Number(r.ledgerEntry.amount) } : null,
    investmentRef: r.investmentRef,
    reversedAt: r.reversedAt?.toISOString() ?? null,
    reversalOfId: r.reversalOfId,
    createdAt: r.createdAt.toISOString(),
  }));
}
