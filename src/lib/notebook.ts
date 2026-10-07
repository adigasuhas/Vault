import { db } from "@/lib/db";
import { audit, recordExpense, voidExpense, type Tx } from "@/lib/ledger";
import { createSchedule } from "@/lib/schedules";
import { ValidationError } from "@/lib/validate";
import { dateOnly } from "@/lib/dates";

/**
 * Notebook: planning notes for money spent outside the monthly routine, paid
 * by the user or by someone on their behalf. Entries never touch the ledger,
 * balances, outflow or budgets until the user turns one into something real:
 * a loan (see /api/loans), an expense, or a receivable.
 */

export const MOVED_REASON = "Moved to Notebook";

const migrated = new Set<string>();

/** One-time expenses predate the Notebook and were booked like any expense.
 * Moves each remaining one into the Notebook and voids the expense (a
 * REVERSAL puts the money back in its account), so they stop counting toward
 * outflow and balances. Idempotent; an expense on a closed account is left
 * alone, since a closed account can't take the reversal. */
export async function moveOneTimeExpensesToNotebook(userId: string) {
  if (migrated.has(userId)) return 0;
  const expenses = await db.expense.findMany({
    where: { userId, oneTime: true, voidedAt: null },
    include: { category: { select: { name: true } }, account: { select: { status: true } } },
    orderBy: { date: "asc" },
  });
  let moved = 0;
  for (const e of expenses) {
    if (e.account?.status === "CLOSED") continue;
    try {
      await db.$transaction(async (tx: Tx) => {
        const already = await tx.notebookEntry.findUnique({ where: { sourceExpenseId: e.id } });
        if (!already) {
          await tx.notebookEntry.create({
            data: {
              userId,
              title: e.description || e.category.name,
              amount: e.amount,
              currency: e.currency,
              date: e.date,
              paidBy: "ME",
              notes: e.notes,
              projectId: e.projectId,
              sourceExpenseId: e.id,
            },
          });
        }
        await voidExpense(userId, e.id, MOVED_REASON, tx);
      });
      moved++;
    } catch (err) {
      // Never block the app on this; the next request tries again.
      console.error(`notebook: couldn't move one-time expense ${e.id}`, err);
      return moved;
    }
  }
  migrated.add(userId);
  return moved;
}

async function openEntry(tx: Tx | typeof db, userId: string, id: string) {
  const entry = await tx.notebookEntry.findFirst({ where: { id, userId } });
  if (!entry) throw new ValidationError("Notebook entry not found.");
  if (entry.status !== "OPEN") throw new ValidationError("This entry has already been turned into something else.");
  return entry;
}

/** Marks an entry as turned into `to` (inside the caller's transaction). */
export async function markConverted(tx: Tx, userId: string, id: string, to: "LOAN" | "EXPENSE" | "RECEIVABLE", targetId: string) {
  const entry = await openEntry(tx, userId, id);
  await tx.notebookEntry.update({ where: { id: entry.id }, data: { status: "CONVERTED", convertedTo: to, convertedId: targetId, convertedAt: new Date() } });
  await audit(tx, userId, "notebook", entry.id, "notebook.convert", `${entry.title}: turned into ${to.toLowerCase()}`, { targetId });
  return entry;
}

/** Books the entry as a real expense from an account. Retrying is safe: the
 * expense is keyed to the entry, so it's only ever booked once. */
export async function convertToExpense(userId: string, id: string, input: { accountId: string; categoryId: string; date?: Date }) {
  const entry = await openEntry(db, userId, id);
  const [account, category] = await Promise.all([
    db.account.findFirst({ where: { id: input.accountId, userId } }),
    db.category.findFirst({ where: { id: input.categoryId, userId } }),
  ]);
  if (!account) throw new ValidationError("Account not found.");
  if (!category) throw new ValidationError("Category not found.");
  if (account.currency !== entry.currency) throw new ValidationError(`${entry.title} is in ${entry.currency}; ${account.name} is in ${account.currency}.`);
  if (await db.loan.findFirst({ where: { categoryId: category.id, userId }, select: { id: true } })) {
    throw new ValidationError("Pick a regular category. To pay a loan, log its EMI from Budget.");
  }
  const { expense } = await recordExpense(userId, {
    accountId: account.id,
    categoryId: category.id,
    amount: Number(entry.amount),
    currency: entry.currency,
    date: dateOnly(input.date ?? entry.date),
    description: entry.title,
    notes: entry.notes ?? undefined,
    idempotencyKey: `notebook:${entry.id}`,
  });
  await db.$transaction((tx: Tx) => markConverted(tx, userId, entry.id, "EXPENSE", expense.id));
  return expense;
}

/** Turns the entry into money the user expects back: a one-off incoming
 * payment into `accountId` on `date`, confirmed by the user when it arrives. */
export async function convertToReceivable(userId: string, id: string, input: { accountId: string; date: Date }) {
  return db.$transaction(async (tx: Tx) => {
    const entry = await openEntry(tx, userId, id);
    const account = await tx.account.findFirst({ where: { id: input.accountId, userId } });
    if (!account) throw new ValidationError("Account not found.");
    if (account.currency !== entry.currency) throw new ValidationError(`${entry.title} is in ${entry.currency}; ${account.name} is in ${account.currency}.`);
    const schedule = await createSchedule(
      userId,
      {
        direction: "INCOME",
        kind: "OTHER_INCOME",
        name: entry.person ? `${entry.title} (from ${entry.person})` : entry.title,
        amount: Number(entry.amount),
        accountId: account.id,
        frequency: "ONE_TIME",
        startDate: dateOnly(input.date),
        requiresConfirmation: true,
        notes: entry.notes,
      },
      tx
    );
    await markConverted(tx, userId, entry.id, "RECEIVABLE", schedule.id);
    return schedule;
  });
}
