import { db } from "@/lib/db";
import { authed, notFound } from "@/lib/api";
import { adjustOpeningBalance, signedAmount } from "@/lib/ledger";
import { parseJson, queryDate, ValidationError } from "@/lib/validate";
import { patchAccountSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

const LEDGER_TYPES = ["EXPENSE", "INCOME", "TRANSFER_IN", "TRANSFER_OUT", "ADJUSTMENT", "OPENING", "REVERSAL", "INVESTMENT_SALE"] as const;
const PAGE_SIZE = 40;

/** Account statement: every entry (including reversed ones and their
 * reversals), newest first, with a running balance. The running balance is
 * computed over the account's full history so it always ends at the current
 * balance, whatever filter is applied to the rows shown. */
export const GET = authed<{ id: string }>(async (req, { userId, params }) => {
  const account = await db.account.findFirst({ where: { id: params.id, userId } });
  if (!account) return notFound("Account not found.");

  const sp = req.nextUrl.searchParams;
  const page = Math.max(0, Number(sp.get("page")) || 0);
  const typeFilter = LEDGER_TYPES.includes(sp.get("type") as never) ? (sp.get("type") as (typeof LEDGER_TYPES)[number]) : undefined;
  const from = queryDate(sp, "from");
  const to = queryDate(sp, "to");

  const all = await db.ledgerEntry.findMany({
    where: { accountId: account.id },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    include: {
      transfer: { select: { fromAccountId: true, toAccountId: true, reversedAt: true, fromAccount: { select: { name: true } }, toAccount: { select: { name: true } } } },
      category: { select: { name: true } },
      creditExecution: { select: { scheduledCredit: { select: { name: true, direction: true } } } },
    },
  });

  // Accumulate in integer cents: summing floats drifts over long histories.
  let runningCents = 0;
  const rows = all.map((e) => {
    runningCents += Math.round(signedAmount(e.type, Number(e.amount)) * 100);
    const running = runningCents / 100;
    const t = e.transfer;
    return {
      id: e.id,
      type: e.type,
      amount: Number(e.amount),
      signed: signedAmount(e.type, Number(e.amount)),
      currency: e.currency,
      date: e.date,
      description: e.description,
      categoryName: e.category?.name ?? null,
      counterpartyName: t ? (t.fromAccountId === account.id ? t.toAccount.name : t.fromAccount.name) : null,
      scheduleName: e.creditExecution?.scheduledCredit.name ?? null,
      reversedAt: e.reversedAt,
      isReversal: e.type === "REVERSAL",
      runningBalance: running,
    };
  });

  const filtered = rows
    .filter((r) => (!typeFilter || r.type === typeFilter) && (!from || r.date >= from) && (!to || r.date <= to))
    .reverse();
  const running = runningCents / 100;
  const reconciled = Math.abs(runningCents - Math.round(Number(account.currentBalance) * 100)) < 1;
  if (!reconciled) console.error(`Account ${account.id} does not reconcile: ledger ${running} vs balance ${account.currentBalance}`);

  return {
    account,
    ledgerEntries: filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    page,
    pageSize: PAGE_SIZE,
    total: filtered.length,
    hasMore: (page + 1) * PAGE_SIZE < filtered.length,
    reconciled,
    ledgerBalance: running,
  };
});

export const PATCH = authed<{ id: string }>(async (req, { userId, params }) => {
  const existing = await db.account.findFirst({ where: { id: params.id, userId } });
  if (!existing) return notFound("Account not found.");
  if (existing.status === "CLOSED") throw new ValidationError("A closed account can't be edited.");
  const input = await parseJson(req, patchAccountSchema);

  if (input.openingBalance !== undefined) {
    await adjustOpeningBalance(userId, existing.id, input.openingBalance, input.openingBalanceReason || undefined);
  }
  const account = await db.account.update({
    where: { id: existing.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.bankName !== undefined ? { bankName: input.bankName } : {}),
      ...(input.branchName !== undefined ? { branchName: input.branchName } : {}),
      ...(input.accountNumber !== undefined ? { accountNumber: input.accountNumber } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.creditLimit !== undefined ? { creditLimit: input.creditLimit } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    },
  });
  return { account };
});

/** Accounts are never hard-deleted — see POST /api/accounts/:id/close. */
export const DELETE = authed<{ id: string }>(async () => {
  throw new ValidationError("Accounts can't be deleted. Close it instead and its history stays.");
});
