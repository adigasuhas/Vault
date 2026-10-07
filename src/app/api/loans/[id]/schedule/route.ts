import { db } from "@/lib/db";
import { authed, notFound } from "@/lib/api";
import { parseJson, ValidationError } from "@/lib/validate";
import { loanScheduleSchema } from "@/lib/schemas";
import type { Tx } from "@/lib/ledger";
import { createEmiSchedule } from "@/lib/loan-schedule";
import { runDueSchedules } from "@/lib/schedules";

export const dynamic = "force-dynamic";

/** Sets up the EMI schedule for an existing loan. */
export const POST = authed<{ id: string }>(async (req, { userId, params }) => {
  const loan = await db.loan.findFirst({ where: { id: params.id, userId }, include: { schedule: true } });
  if (!loan) return notFound("Loan not found.");
  if (loan.status === "CLOSED") throw new ValidationError("This loan is closed.");
  if (loan.schedule) throw new ValidationError("This loan already has an EMI schedule.");
  const input = await parseJson(req, loanScheduleSchema);
  const account = await db.account.findFirst({ where: { id: input.accountId, userId, status: { not: "CLOSED" } } });
  if (!account) throw new ValidationError("Choose an open account.");
  if (account.currency !== loan.currency) throw new ValidationError(`The loan is in ${loan.currency}; ${account.name} is in ${account.currency}.`);
  const schedule = await db.$transaction((tx: Tx) => createEmiSchedule(tx, userId, loan, input));
  await runDueSchedules(new Date(), userId);
  return { schedule };
});
