import { db } from "@/lib/db";
import { Prisma, type LedgerEntryType } from "@prisma/client";
import { ValidationError, MAX_AMOUNT } from "@/lib/validate";
import { loanAmortization } from "@/lib/loans";
import { dateOnly, nthOccurrence, type Frequency } from "@/lib/dates";

export type Tx = Prisma.TransactionClient;

/**
 * The ledger is the source of truth. Every balance-affecting action goes
 * through this module, inside one transaction, so `Account.currentBalance`
 * always equals the sum of the account's signed ledger entries.
 *
 * Invariants:
 *  - posted magnitudes are finite and > 0; ADJUSTMENT, OPENING and REVERSAL are
 *    the only signed types (also enforced by a DB CHECK constraint);
 *  - an entry's currency equals its account's currency (cross-currency moves
 *    are two entries, one per side, each in its own currency);
 *  - nothing is ever deleted. Undoing an event posts a REVERSAL entry that
 *    cancels the original and stamps the original's `reversedAt`, so a
 *    statement shows what happened and when it was walked back;
 *  - closed accounts accept no new postings.
 */

/** Balance effect of an entry. */
export function signedAmount(type: LedgerEntryType | string, amount: number): number {
  if (type === "ADJUSTMENT" || type === "OPENING" || type === "REVERSAL") return amount;
  return type === "EXPENSE" || type === "TRANSFER_OUT" ? -amount : amount;
}

/** Account types that hold the user's own money and can't go below zero.
 * Credit cards (and the legacy LOAN type) carry a balance that is a debt. */
const DEBIT_TYPES = new Set([
  "SAVINGS",
  "CURRENT",
  "FIXED_DEPOSIT",
  "CASH_WALLET",
  "DIGITAL_WALLET",
  "PREPAID_CARD",
  "FOREX_CARD",
]);

export function isLiabilityAccount(accountType: string) {
  return !DEBIT_TYPES.has(accountType);
}

export function assertPostable(amount: number, entryCurrency: string, accountCurrency: string) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ValidationError("Amount must be a number greater than zero.");
  }
  if (amount > MAX_AMOUNT) {
    throw new ValidationError(`Amount can't be more than ${MAX_AMOUNT.toLocaleString("en-US")}.`);
  }
  if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) {
    throw new ValidationError("Amount can have at most 2 decimal places.");
  }
  if (entryCurrency !== accountCurrency) {
    throw new ValidationError(
      `This entry is in ${entryCurrency} but the account is in ${accountCurrency}. ` +
        "Log it against an account in the same currency."
    );
  }
}

function assertOpen(account: { name: string; status: string }) {
  if (account.status === "CLOSED") {
    throw new ValidationError(`${account.name} is closed and can't take new transactions.`);
  }
}

/** Funds check for money leaving an account. Debit accounts can't go below
 * zero; a credit card can't exceed its limit when one is set. */
export function assertSufficientFunds(
  account: { name: string; accountType: string; currentBalance: Prisma.Decimal | number; currency: string; creditLimit?: Prisma.Decimal | number | null },
  amount: number
) {
  const balance = Number(account.currentBalance);
  if (!isLiabilityAccount(account.accountType)) {
    if (balance - amount < -0.005) {
      throw new ValidationError(
        `Insufficient balance in ${account.name}: available ${balance.toFixed(2)} ${account.currency}, ` +
          `needed ${amount.toFixed(2)}.`
      );
    }
    return;
  }
  if (account.creditLimit != null) {
    const limit = Number(account.creditLimit);
    if (balance - amount < -limit - 0.005) {
      throw new ValidationError(
        `This would take ${account.name} past its credit limit of ${limit.toFixed(2)} ${account.currency}.`
      );
    }
  }
}

export async function audit(
  tx: Tx,
  userId: string,
  entityType: string,
  entityId: string,
  action: string,
  summary: string,
  detail?: Prisma.InputJsonValue
) {
  await tx.auditEvent.create({ data: { userId, entityType, entityId, action, summary, detail } });
}

type PostInput = {
  userId: string;
  /** Null only for a one-time purchase logged without an account. */
  accountId: string | null;
  type: LedgerEntryType;
  amount: number | Prisma.Decimal; // magnitude, or signed for the signed types
  currency: string;
  date: Date;
  description?: string | null;
  expenseId?: string;
  transferId?: string;
  creditExecutionId?: string;
  loanPaymentId?: string;
  investmentSaleId?: string;
  categoryId?: string | null;
  reversalOfId?: string;
  oneTime?: boolean;
  countInBudget?: boolean;
};

/** Writes one entry and moves the account balance by its signed effect
 * (entries without an account move no balance). */
async function post(tx: Tx, input: PostInput) {
  const effect = signedAmount(input.type, Number(input.amount));
  if (input.accountId) {
    await tx.account.update({
      where: { id: input.accountId },
      data: { currentBalance: { increment: effect } },
    });
  }
  return tx.ledgerEntry.create({
    data: {
      userId: input.userId,
      accountId: input.accountId,
      type: input.type,
      amount: input.amount,
      currency: input.currency,
      date: dateOrToday(input.date),
      description: input.description ?? null,
      expenseId: input.expenseId,
      transferId: input.transferId,
      creditExecutionId: input.creditExecutionId,
      loanPaymentId: input.loanPaymentId,
      investmentSaleId: input.investmentSaleId,
      categoryId: input.categoryId ?? null,
      reversalOfId: input.reversalOfId,
      oneTime: input.oneTime ?? false,
      countInBudget: input.countInBudget ?? false,
    },
  });
}

function dateOrToday(d: Date | undefined) {
  return d && !Number.isNaN(d.getTime()) ? d : dateOnly(new Date());
}

/** Cancels an entry with an equal-and-opposite REVERSAL entry. The reversal is
 * dated no earlier than the original so statements stay in order. */
async function reverseEntry(tx: Tx, entryId: string, description: string, when: Date = new Date()) {
  const entry = await tx.ledgerEntry.findUniqueOrThrow({ where: { id: entryId } });
  if (entry.reversedAt) throw new ValidationError("This entry has already been reversed.");
  if (entry.type === "REVERSAL") throw new ValidationError("A reversal can't itself be reversed.");
  const effect = signedAmount(entry.type, Number(entry.amount));
  const day = dateOnly(when);
  const reversal = await post(tx, {
    userId: entry.userId,
    accountId: entry.accountId,
    type: "REVERSAL",
    amount: -effect,
    currency: entry.currency,
    date: day > entry.date ? day : entry.date,
    description,
    transferId: entry.transferId ?? undefined,
    categoryId: entry.categoryId,
    reversalOfId: entry.id,
    oneTime: entry.oneTime,
    countInBudget: entry.countInBudget,
  });
  await tx.ledgerEntry.update({ where: { id: entry.id }, data: { reversedAt: when } });
  return reversal;
}

// ---------------------------------------------------------------- accounts

export async function createAccount(
  userId: string,
  input: {
    name: string;
    bankName?: string;
    branchName?: string;
    accountNumber?: string;
    currency: string;
    accountType: Prisma.AccountCreateInput["accountType"];
    openingBalance: number;
    openingDate?: Date;
    creditLimit?: number | null;
    notes?: string;
  }
) {
  return db.$transaction(async (tx: Tx) => {
    const openingDate = dateOrToday(input.openingDate ? dateOnly(input.openingDate) : undefined);
    const account = await tx.account.create({
      data: {
        userId,
        name: input.name,
        bankName: input.bankName,
        branchName: input.branchName,
        accountNumber: input.accountNumber,
        currency: input.currency,
        accountType: input.accountType,
        openingBalance: input.openingBalance,
        currentBalance: 0,
        openingDate,
        creditLimit: input.creditLimit ?? null,
        notes: input.notes,
      },
    });
    if (input.openingBalance !== 0) {
      await post(tx, {
        userId,
        accountId: account.id,
        type: "OPENING",
        amount: input.openingBalance,
        currency: input.currency,
        date: openingDate,
        description: "Opening balance",
      });
    }
    return tx.account.findUniqueOrThrow({ where: { id: account.id } });
  });
}

/** Corrects an account's opening balance after the fact. Posts the difference
 * as an ADJUSTMENT (the original OPENING entry stays), so every statement and
 * the running balance remain exact. Returns null when nothing changes. */
export async function adjustOpeningBalance(
  userId: string,
  accountId: string,
  newOpeningBalance: number,
  reason?: string
) {
  return db.$transaction(async (tx: Tx) => {
    const account = await tx.account.findFirstOrThrow({ where: { id: accountId, userId } });
    assertOpen(account);
    const oldOpeningBalance = Number(account.openingBalance);
    const delta = Math.round((newOpeningBalance - oldOpeningBalance) * 100) / 100;
    if (delta === 0) return null;

    const ledgerEntry = await post(tx, {
      userId,
      accountId,
      type: "ADJUSTMENT",
      amount: delta,
      currency: account.currency,
      date: dateOnly(new Date()),
      description:
        `Opening balance corrected: ${oldOpeningBalance} → ${newOpeningBalance}` + (reason ? ` (${reason})` : ""),
    });
    const updated = await tx.account.update({ where: { id: accountId }, data: { openingBalance: newOpeningBalance } });
    await audit(tx, userId, "account", accountId, "account.opening_corrected", `Opening balance of ${account.name} corrected`, {
      from: oldOpeningBalance,
      to: newOpeningBalance,
      reason: reason ?? null,
    });
    return { account: updated, ledgerEntry };
  });
}

/**
 * Closes an account. The only way an account leaves the app — the row and
 * its full ledger stay, it just stops accepting postings and drops out of
 * balances. A non-zero balance must be either transferred out (to another
 * open account in the same currency) or explicitly written off, which posts
 * an ADJUSTMENT to zero so net worth stays honest.
 */
export async function closeAccount(
  userId: string,
  accountId: string,
  input: { transferToAccountId?: string; writeOff?: boolean; note?: string }
) {
  return db.$transaction(async (tx: Tx) => {
    const account = await tx.account.findFirst({ where: { id: accountId, userId } });
    if (!account) throw new ValidationError("Account not found.");
    assertOpen(account);
    const balance = Math.round(Number(account.currentBalance) * 100) / 100;
    const today = dateOnly(new Date());

    const activeSchedules = await tx.scheduledCredit.count({
      where: { receivingAccountId: accountId, isActive: true },
    });
    if (activeSchedules > 0) {
      throw new ValidationError(
        `${activeSchedules} active schedule(s) still use ${account.name}. Point them at another account or end them first.`
      );
    }

    let transferId: string | null = null;
    if (balance !== 0) {
      if (input.transferToAccountId) {
        const target = await tx.account.findFirst({ where: { id: input.transferToAccountId, userId } });
        if (!target || target.id === account.id) throw new ValidationError("Choose a different account to move the balance to.");
        assertOpen(target);
        if (target.currency !== account.currency) {
          throw new ValidationError(`${target.name} is in ${target.currency}; the balance is in ${account.currency}.`);
        }
        if (balance < 0) {
          throw new ValidationError(
            `${account.name} has a negative balance (${balance}). Pay it off with a transfer into it first.`
          );
        }
        const transfer = await tx.transfer.create({
          data: {
            userId,
            fromAccountId: account.id,
            toAccountId: target.id,
            amount: balance,
            currency: account.currency,
            date: today,
            notes: `Closing balance of ${account.name}`,
          },
        });
        transferId = transfer.id;
        await post(tx, { userId, accountId: account.id, type: "TRANSFER_OUT", amount: balance, currency: account.currency, date: today, description: transfer.notes, transferId: transfer.id });
        await post(tx, { userId, accountId: target.id, type: "TRANSFER_IN", amount: balance, currency: account.currency, date: today, description: transfer.notes, transferId: transfer.id });
      } else if (input.writeOff) {
        await post(tx, {
          userId,
          accountId: account.id,
          type: "ADJUSTMENT",
          amount: -balance,
          currency: account.currency,
          date: today,
          description: `Balance written off on closure${input.note ? ` (${input.note})` : ""}`,
        });
      } else {
        throw new ValidationError("This account still has a balance. Move it to another account or confirm a write-off.");
      }
    }

    const closed = await tx.account.update({
      where: { id: account.id },
      data: { status: "CLOSED", closedAt: new Date(), closureNote: input.note ?? null },
    });
    await audit(tx, userId, "account", account.id, "account.close", `Closed ${account.name}`, {
      balanceAtClose: balance,
      movedTo: input.transferToAccountId ?? null,
      transferId,
      writtenOff: balance !== 0 && !input.transferToAccountId,
      note: input.note ?? null,
    });
    return closed;
  });
}

// ---------------------------------------------------------------- expenses

export async function recordExpense(
  userId: string,
  input: {
    /** Required unless oneTime: a one-off can be logged without saying how it was paid. */
    accountId: string | null;
    categoryId: string;
    amount: number;
    currency: string;
    date: Date;
    description?: string;
    notes?: string;
    receiptUrl?: string;
    idempotencyKey?: string;
    oneTime?: boolean;
    countInBudget?: boolean;
    projectId?: string | null;
  }
) {
  const oneTime = input.oneTime ?? false;
  const countInBudget = oneTime && (input.countInBudget ?? false);
  if (!input.accountId && !oneTime) throw new ValidationError("Choose the account this was paid from.");
  if (input.idempotencyKey) {
    const existing = await db.expense.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } },
    });
    if (existing) return { expense: existing, duplicate: true as const };
  }
  try {
    return await db.$transaction(async (tx: Tx) => {
      if (input.accountId) {
        const account = await tx.account.findFirstOrThrow({ where: { id: input.accountId, userId } });
        assertOpen(account);
        assertPostable(input.amount, input.currency, account.currency);
      } else {
        assertPostable(input.amount, input.currency, input.currency);
      }

      const expense = await tx.expense.create({
        data: {
          userId,
          accountId: input.accountId,
          categoryId: input.categoryId,
          amount: input.amount,
          currency: input.currency,
          date: input.date,
          description: input.description,
          notes: input.notes,
          receiptUrl: input.receiptUrl,
          idempotencyKey: input.idempotencyKey,
          oneTime,
          countInBudget,
          projectId: oneTime ? (input.projectId ?? null) : null,
        },
      });
      const ledgerEntry = await post(tx, {
        userId,
        accountId: input.accountId,
        type: "EXPENSE",
        amount: input.amount,
        currency: input.currency,
        date: input.date,
        description: input.description,
        expenseId: expense.id,
        categoryId: input.categoryId,
        oneTime,
        countInBudget,
      });
      return { expense, ledgerEntry, duplicate: false as const };
    });
  } catch (err) {
    // Two identical submissions raced past the lookup above: the unique key
    // let exactly one through. Return that one.
    if (input.idempotencyKey && err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const existing = await db.expense.findUniqueOrThrow({
        where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } },
      });
      return { expense: existing, duplicate: true as const };
    }
    throw err;
  }
}

/** Voids an expense: the row stays (stamped voidedAt), its ledger entry is
 * cancelled by a REVERSAL, and the money returns to the account. */
export async function voidExpense(userId: string, expenseId: string, reason?: string, txIn?: Tx) {
  const run = async (tx: Tx) => {
    const expense = await tx.expense.findFirst({ where: { id: expenseId, userId }, include: { ledgerEntry: true, account: true } });
    if (!expense) throw new ValidationError("Expense not found.");
    if (expense.voidedAt) throw new ValidationError("This expense was already removed.");
    if (expense.account) assertOpen(expense.account);
    if (expense.ledgerEntry && !expense.ledgerEntry.reversedAt) {
      await reverseEntry(tx, expense.ledgerEntry.id, `Expense removed${reason ? ` (${reason})` : ""}`);
    }
    await tx.expense.update({ where: { id: expenseId }, data: { voidedAt: new Date(), voidReason: reason ?? null } });
    await audit(tx, userId, "expense", expenseId, "expense.void", `Removed expense ${expense.description || ""}`.trim(), {
      amount: Number(expense.amount),
      reason: reason ?? null,
    });
    return expense;
  };
  return txIn ? run(txIn) : db.$transaction(run);
}

/** Edits an expense by voiding the original and booking the corrected one in
 * the same transaction — the statement keeps both, nothing is overwritten. */
export async function amendExpense(
  userId: string,
  expenseId: string,
  changes: {
    accountId?: string | null;
    /** Only used when there's no account (otherwise the account's currency). */
    currency?: string;
    categoryId?: string;
    amount?: number;
    date?: Date;
    description?: string | null;
    notes?: string | null;
    oneTime?: boolean;
    countInBudget?: boolean;
    projectId?: string | null;
  }
) {
  return db.$transaction(async (tx: Tx) => {
    const original = await voidExpense(userId, expenseId, "edited", tx);
    const accountId = changes.accountId === undefined ? original.accountId : changes.accountId;
    const oneTimeNext = changes.oneTime ?? original.oneTime;
    if (!accountId && !oneTimeNext) throw new ValidationError("Choose the account this was paid from.");
    const account = accountId ? await tx.account.findFirst({ where: { id: accountId, userId } }) : null;
    if (accountId && !account) throw new ValidationError("Account not found.");
    if (account) assertOpen(account);
    // Without an account the purchase keeps its own currency.
    const currency = account?.currency ?? changes.currency ?? original.currency;
    const categoryId = changes.categoryId ?? original.categoryId;
    const category = await tx.category.findFirst({ where: { id: categoryId, userId } });
    if (!category) throw new ValidationError("Category not found.");
    const amount = changes.amount ?? Number(original.amount);
    assertPostable(amount, currency, currency);
    const description = changes.description === undefined ? original.description : changes.description;
    const date = changes.date ?? original.date;
    const notes = changes.notes === undefined ? original.notes : changes.notes;
    const oneTime = changes.oneTime ?? original.oneTime;
    const countInBudget = oneTime && (changes.countInBudget ?? original.countInBudget);
    const projectId = !oneTime ? null : changes.projectId === undefined ? original.projectId : changes.projectId;
    if (projectId && !(await tx.expenseProject.findFirst({ where: { id: projectId, userId } }))) throw new ValidationError("Group not found.");

    const expense = await tx.expense.create({
      data: {
        userId,
        accountId,
        categoryId,
        amount,
        currency,
        date,
        description,
        notes,
        receiptUrl: original.receiptUrl,
        oneTime,
        countInBudget,
        projectId,
      },
    });
    await post(tx, {
      userId,
      accountId,
      type: "EXPENSE",
      amount,
      currency,
      date,
      description,
      expenseId: expense.id,
      categoryId,
      oneTime,
      countInBudget,
    });
    await audit(tx, userId, "expense", expense.id, "expense.amend", `Edited expense ${description || ""}`.trim(), {
      replaces: expenseId,
    });
    return expense;
  });
}

// ---------------------------------------------------------------- transfers

export class DuplicateTransferWarning extends ValidationError {
  constructor(public existingId: string) {
    super("An identical transfer was made a moment ago. Confirm if you really want to send it again.");
    this.name = "DuplicateTransferWarning";
  }
}

export async function recordTransfer(
  userId: string,
  input: {
    fromAccountId: string;
    toAccountId: string;
    amount: number;
    /** Amount arriving in the destination's currency — required when the two
     * accounts' currencies differ (e.g. INR → forex card in USD). */
    toAmount?: number;
    date: Date;
    notes?: string;
    idempotencyKey?: string;
    confirmDuplicate?: boolean;
  }
) {
  if (input.fromAccountId === input.toAccountId) {
    throw new ValidationError("Source and destination accounts must be different.");
  }
  if (input.idempotencyKey) {
    const existing = await db.transfer.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } },
    });
    if (existing) return { transfer: existing, duplicate: true as const };
  }

  try {
    const transfer = await db.$transaction(async (tx: Tx) => {
      // Lock both rows in a stable order so concurrent transfers can't both
      // pass the funds check against the same balance.
      const ids = [input.fromAccountId, input.toAccountId].sort();
      await tx.$executeRaw`SELECT id FROM "Account" WHERE id IN (${ids[0]}, ${ids[1]}) AND "userId" = ${userId} ORDER BY id FOR UPDATE`;
      const [from, to] = await Promise.all([
        tx.account.findFirst({ where: { id: input.fromAccountId, userId } }),
        tx.account.findFirst({ where: { id: input.toAccountId, userId } }),
      ]);
      if (!from || !to) throw new ValidationError("One or both accounts were not found.");
      assertOpen(from);
      assertOpen(to);
      assertPostable(input.amount, from.currency, from.currency);

      let toAmount = input.amount;
      if (from.currency !== to.currency) {
        if (!(input.toAmount && input.toAmount > 0)) {
          throw new ValidationError(
            `${from.name} is in ${from.currency} and ${to.name} in ${to.currency}. Enter the amount that arrives in ${to.currency}.`
          );
        }
        toAmount = input.toAmount;
      }
      assertSufficientFunds(from, input.amount);

      if (!input.confirmDuplicate) {
        const recent = await tx.transfer.findFirst({
          where: {
            userId,
            fromAccountId: from.id,
            toAccountId: to.id,
            amount: input.amount,
            reversedAt: null,
            createdAt: { gte: new Date(Date.now() - 10 * 60_000) },
          },
        });
        if (recent) throw new DuplicateTransferWarning(recent.id);
      }

      const crossCurrency = from.currency !== to.currency;
      const transfer = await tx.transfer.create({
        data: {
          userId,
          fromAccountId: from.id,
          toAccountId: to.id,
          amount: input.amount,
          currency: from.currency,
          toAmount: crossCurrency ? toAmount : null,
          toCurrency: crossCurrency ? to.currency : null,
          date: input.date,
          notes: input.notes,
          idempotencyKey: input.idempotencyKey,
        },
      });
      await post(tx, { userId, accountId: from.id, type: "TRANSFER_OUT", amount: input.amount, currency: from.currency, date: input.date, description: input.notes, transferId: transfer.id });
      await post(tx, { userId, accountId: to.id, type: "TRANSFER_IN", amount: toAmount, currency: to.currency, date: input.date, description: input.notes, transferId: transfer.id });
      return transfer;
    });
    return { transfer, duplicate: false as const };
  } catch (err) {
    if (input.idempotencyKey && err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const existing = await db.transfer.findUniqueOrThrow({
        where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } },
      });
      return { transfer: existing, duplicate: true as const };
    }
    throw err;
  }
}

/** Reverses a transfer with compensating entries on both sides. The original
 * entries stay on both statements, each paired with its reversal. */
export async function reverseTransfer(userId: string, transferId: string, reason?: string) {
  return db.$transaction(async (tx: Tx) => {
    const transfer = await tx.transfer.findFirst({
      where: { id: transferId, userId },
      include: { fromAccount: true, toAccount: true, ledgerEntries: true },
    });
    if (!transfer) throw new ValidationError("Transfer not found.");
    if (transfer.reversedAt) throw new ValidationError("This transfer has already been reversed.");
    assertOpen(transfer.fromAccount);
    assertOpen(transfer.toAccount);
    // Taking the money back out of the destination must not overdraw it.
    assertSufficientFunds(transfer.toAccount, Number(transfer.toAmount ?? transfer.amount));

    const label = `Reversal of transfer ${transfer.fromAccount.name} → ${transfer.toAccount.name}`;
    for (const entry of transfer.ledgerEntries.filter((e) => e.type !== "REVERSAL" && !e.reversedAt)) {
      await reverseEntry(tx, entry.id, reason ? `${label} (${reason})` : label);
    }
    const updated = await tx.transfer.update({
      where: { id: transferId },
      data: { reversedAt: new Date(), reversalReason: reason ?? null },
    });
    await audit(tx, userId, "transfer", transferId, "transfer.reverse", label, {
      amount: Number(transfer.amount),
      currency: transfer.currency,
      reason: reason ?? null,
    });
    return updated;
  });
}

// ---------------------------------------------------------------- income

/** One-off income booked directly by the user (e.g. a refund that wasn't
 * scheduled, or unallocated budget income recognised on an account). */
export async function recordManualIncome(
  userId: string,
  input: { accountId: string; amount: number; currency: string; date: Date; description?: string }
) {
  return db.$transaction(async (tx: Tx) => {
    const account = await tx.account.findFirstOrThrow({ where: { id: input.accountId, userId } });
    assertOpen(account);
    assertPostable(input.amount, input.currency, account.currency);
    return post(tx, {
      userId,
      accountId: input.accountId,
      type: "INCOME",
      amount: input.amount,
      currency: input.currency,
      date: input.date,
      description: input.description,
    });
  });
}

// ---------------------------------------------------------------- investments

/** Credits the net proceeds of an investment sale to an account. Runs in the
 * caller's transaction, after the InvestmentSale row exists. */
export async function postInvestmentSale(
  tx: Tx,
  userId: string,
  input: { saleId: string; accountId: string; amount: number; currency: string; date: Date; description: string }
) {
  const account = await tx.account.findFirst({ where: { id: input.accountId, userId } });
  if (!account) throw new ValidationError("Account not found.");
  assertOpen(account);
  assertPostable(input.amount, input.currency, account.currency);
  return post(tx, {
    userId,
    accountId: account.id,
    type: "INVESTMENT_SALE",
    amount: input.amount,
    currency: input.currency,
    date: input.date,
    description: input.description,
    investmentSaleId: input.saleId,
  });
}

/** Takes a sale's proceeds back out of the account it was credited to. */
export async function reverseInvestmentSale(tx: Tx, userId: string, saleId: string, reason: string) {
  const entry = await tx.ledgerEntry.findFirst({ where: { investmentSaleId: saleId, userId }, include: { account: true } });
  if (!entry) throw new ValidationError("This sale has no ledger entry to reverse.");
  if (entry.account) {
    assertOpen(entry.account);
    assertSufficientFunds(entry.account, Number(entry.amount));
  }
  return reverseEntry(tx, entry.id, reason);
}

// ---------------------------------------------------------------- loans

/** Records an EMI payment against a loan. Splits it into principal / interest
 * from the reducing-balance schedule position and, when paid from an account,
 * books it to the ledger under the loan's category. Closes the loan once every
 * installment is recorded. Runs inside the caller's transaction when given
 * (the EMI schedule confirms through here). */
export async function recordLoanPayment(
  userId: string,
  input: { loanId: string; amount: number; paidOn: Date; fromAccountId?: string; note?: string; occurrenceId?: string; creditExecutionId?: string },
  txIn?: Tx
) {
  if (!(input.amount > 0)) throw new ValidationError("Payment amount must be greater than zero.");

  const run = async (tx: Tx) => {
    const loan = await tx.loan.findFirst({ where: { id: input.loanId, userId } });
    if (!loan) throw new ValidationError("Loan not found.");

    const existing = await tx.loanPayment.count({ where: { loanId: loan.id, reversedAt: null } });
    const schedule = loanAmortization(loan);
    if (existing >= schedule.length) throw new ValidationError("This loan is already fully paid.");
    const row = schedule[existing];

    const interestShare = row.emi > 0 ? row.interest / row.emi : 0;
    const interestComponent = Math.min(input.amount, input.amount * interestShare);
    const principalComponent = input.amount - interestComponent;

    let account: Awaited<ReturnType<typeof tx.account.findFirst>> = null;
    if (input.fromAccountId) {
      account = await tx.account.findFirst({ where: { id: input.fromAccountId, userId } });
      if (!account) throw new ValidationError("Payment account not found.");
      assertOpen(account);
      if (account.currency !== loan.currency) {
        throw new ValidationError(`The loan is in ${loan.currency} but that account is in ${account.currency}.`);
      }
    }

    const payment = await tx.loanPayment.create({
      data: {
        loanId: loan.id,
        amount: input.amount,
        principalComponent,
        interestComponent,
        paidOn: input.paidOn,
        note: input.note,
        occurrenceId: input.occurrenceId,
      },
    });

    if (account) {
      await post(tx, {
        userId,
        accountId: account.id,
        type: "EXPENSE",
        amount: input.amount,
        currency: loan.currency,
        date: input.paidOn,
        description: `${loan.name}: EMI ${row.n} of ${schedule.length}`,
        loanPaymentId: payment.id,
        creditExecutionId: input.creditExecutionId,
        categoryId: loan.categoryId,
      });
    }

    if (existing + 1 >= schedule.length) {
      await tx.loan.update({ where: { id: loan.id }, data: { status: "CLOSED" } });
      await tx.scheduledCredit.updateMany({ where: { loanId: loan.id, isActive: true }, data: { isActive: false, cancelledAt: new Date() } });
      if (loan.categoryId) {
        await tx.category.update({ where: { id: loan.categoryId }, data: { isDefault: false, defaultAmount: 0 } });
      }
    }
    return payment;
  };
  return txIn ? run(txIn) : db.$transaction(run);
}

// ---------------------------------------------------------------- schedules (shared posting)

/** Books one schedule occurrence: INCOME into the account for a receivable,
 * EXPENSE out of it (under the schedule's category) for a payment, or an EMI
 * via recordLoanPayment for a loan's schedule. Runs in the caller's tx. */
export async function postOccurrence(
  tx: Tx,
  schedule: {
    id: string;
    userId: string;
    name: string;
    direction: "INCOME" | "PAYMENT";
    receivingAccountId: string;
    currency: string;
    categoryId: string | null;
    loanId: string | null;
  },
  occurrence: { id: string; amount: number; date: Date }
) {
  const account = await tx.account.findFirst({ where: { id: schedule.receivingAccountId, userId: schedule.userId } });
  if (!account) throw new ValidationError("The schedule's account no longer exists.");
  assertOpen(account);
  assertPostable(occurrence.amount, schedule.currency, account.currency);

  if (schedule.direction === "INCOME") {
    return post(tx, {
      userId: schedule.userId,
      accountId: account.id,
      type: "INCOME",
      amount: occurrence.amount,
      currency: schedule.currency,
      date: occurrence.date,
      description: schedule.name,
      creditExecutionId: occurrence.id,
    });
  }
  if (schedule.loanId) {
    await recordLoanPayment(
      schedule.userId,
      {
        loanId: schedule.loanId,
        amount: occurrence.amount,
        paidOn: occurrence.date,
        fromAccountId: account.id,
        occurrenceId: occurrence.id,
        creditExecutionId: occurrence.id,
      },
      tx
    );
    return tx.ledgerEntry.findUnique({ where: { creditExecutionId: occurrence.id } });
  }
  return post(tx, {
    userId: schedule.userId,
    accountId: account.id,
    type: "EXPENSE",
    amount: occurrence.amount,
    currency: schedule.currency,
    date: occurrence.date,
    description: schedule.name,
    creditExecutionId: occurrence.id,
    categoryId: schedule.categoryId,
  });
}

/** Undoes a booked occurrence with a REVERSAL entry; an EMI's LoanPayment is
 * stamped reversed so it stops counting toward the loan. */
export async function reverseOccurrenceEntry(tx: Tx, occurrenceId: string, reason: string) {
  const entry = await tx.ledgerEntry.findUnique({ where: { creditExecutionId: occurrenceId } });
  if (!entry) throw new ValidationError("There's nothing booked for this payment, so there's nothing to reverse.");
  if (entry.accountId) assertOpen(await tx.account.findUniqueOrThrow({ where: { id: entry.accountId } }));
  await reverseEntry(tx, entry.id, reason);
  const loanPayment = await tx.loanPayment.findUnique({ where: { occurrenceId } });
  if (loanPayment) {
    // A reversed EMI stays on record but no longer counts toward the loan.
    await tx.loanPayment.update({ where: { id: loanPayment.id }, data: { reversedAt: new Date() } });
    await tx.loan.update({ where: { id: loanPayment.loanId }, data: { status: "ACTIVE" } });
  }
}

/** Kept for callers/tests that want "the occurrence after `from`". */
export function computeNextExecutionDate(from: Date, frequency: string, customIntervalDays?: number | null): Date {
  if (frequency === "ONE_TIME") return from;
  return nthOccurrence(from, frequency as Frequency, 1, customIntervalDays);
}
