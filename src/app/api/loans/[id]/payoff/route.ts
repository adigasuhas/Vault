import { z } from "zod";
import { db } from "@/lib/db";
import { authed } from "@/lib/api";
import { payOffLoan, type Tx } from "@/lib/ledger";
import { parseJson, zId, zIsoDate, zPositive } from "@/lib/validate";
import { syncScheduledBudgets, userToday } from "@/lib/schedules";
import { dateOnly } from "@/lib/dates";

export const dynamic = "force-dynamic";

const schema = z.object({
  accountId: zId,
  date: zIsoDate.optional(),
  /** Defaults to the outstanding principal; more is booked as interest/charges. */
  amount: zPositive.optional(),
});

/** Pays the loan off in one payment and closes it. */
export const POST = authed<{ id: string }>(async (req, { userId, params }) => {
  const input = await parseJson(req, schema);
  const date = input.date ? dateOnly(input.date) : await userToday(userId);
  return db.$transaction(async (tx: Tx) => {
    const r = await payOffLoan(userId, { loanId: params.id, accountId: input.accountId, date, amount: input.amount }, tx);
    if (r.loan.categoryId) await syncScheduledBudgets(tx, userId, [r.loan.categoryId]);
    return { paid: r.amount, outstanding: r.outstanding };
  });
});
