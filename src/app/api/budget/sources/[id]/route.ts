import { db } from "@/lib/db";
import { authed, notFound } from "@/lib/api";
import { isoDate } from "@/lib/dates";
import { parseJson, ValidationError } from "@/lib/validate";
import { patchBudgetSourceSchema } from "@/lib/schemas";
import { removeSource, setSource } from "@/lib/budget-funding";

export const dynamic = "force-dynamic";

/** Changes how much of a source the month counts on (never below what its
 * lines already draw, never above what's left of it). */
export const PATCH = authed<{ id: string }>(async (req, { userId, params }) => {
  const s = await db.budgetSource.findFirst({ where: { id: params.id, budgetPlan: { userId } }, include: { budgetPlan: { select: { month: true } } } });
  if (!s) return notFound("Money source not found.");
  const { amount } = await parseJson(req, patchBudgetSourceSchema);
  const ref =
    s.kind === "RECEIVABLE"
      ? s.scheduledCreditId && s.occurrenceDate
        ? { receivable: { scheduleId: s.scheduledCreditId, occurrenceDate: isoDate(s.occurrenceDate) } }
        : null
      : s.accountId
        ? { accountId: s.accountId }
        : null;
  if (!ref) throw new ValidationError(`${s.label} no longer exists, so it can only be removed.`);
  return { source: await setSource(userId, s.budgetPlan.month, ref, amount) };
});

/** Removes a source from its month. Lines it funded keep their amounts and
 * show the part it covered as unfunded. */
export const DELETE = authed<{ id: string }>(async (_req, { userId, params }) => ({ ok: true, ...(await removeSource(userId, params.id)) }));
