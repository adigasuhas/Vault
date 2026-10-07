import { db } from "@/lib/db";
import { authed } from "@/lib/api";
import { amendExpense, voidExpense } from "@/lib/ledger";
import { parseJson, ValidationError } from "@/lib/validate";
import { amendExpenseSchema, noteSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

/** Edits an expense: the original is voided (reversal entry) and the
 * corrected one booked, in one transaction. */
export const PATCH = authed<{ id: string }>(async (req, { userId, params }) => {
  const input = await parseJson(req, amendExpenseSchema);
  const current = await db.expense.findFirst({ where: { id: params.id, userId }, select: { categoryId: true } });
  if (input.categoryId && current && input.categoryId !== current.categoryId && (await db.loan.findFirst({ where: { categoryId: input.categoryId, userId }, select: { id: true } }))) {
    throw new ValidationError("An expense can't be moved into a loan's category. Remove it and log the EMI as a new expense instead, so the loan records the payment.");
  }
  const expense = await amendExpense(userId, params.id, input);
  return { expense };
});

/** Removes an expense from spending. Nothing is deleted: the expense is
 * stamped voided and its ledger entry cancelled by a reversal. */
export const DELETE = authed<{ id: string }>(async (req, { userId, params }) => {
  const body = await parseJson(req, noteSchema).catch(() => ({ reason: undefined, note: undefined }));
  await voidExpense(userId, params.id, body.reason ?? body.note);
  return { ok: true };
});
