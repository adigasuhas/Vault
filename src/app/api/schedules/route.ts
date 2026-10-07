import { db } from "@/lib/db";
import { authed } from "@/lib/api";
import { parseJson } from "@/lib/validate";
import { createScheduleSchema } from "@/lib/schemas";
import { createSchedule, projectSchedule, runDueSchedules, userToday } from "@/lib/schedules";
import { addDaysUTC, addMonthsUTC } from "@/lib/dates";

export const dynamic = "force-dynamic";

/** `?direction=INCOME|PAYMENT`. Each schedule comes with its next few
 * occurrences (projected, with overrides) and its recent history. */
export const GET = authed(async (req, { userId }) => {
  const direction = req.nextUrl.searchParams.get("direction");
  const today = await userToday(userId);
  const schedules = await db.scheduledCredit.findMany({
    where: { userId, ...(direction === "INCOME" || direction === "PAYMENT" ? { direction } : {}) },
    include: {
      overrides: true,
      executions: { orderBy: { executedDate: "desc" } },
      receivingAccount: { select: { id: true, name: true, currency: true, status: true } },
      category: { select: { id: true, name: true } },
      loan: { select: { id: true, name: true } },
    },
    orderBy: [{ isActive: "desc" }, { nextExecutionDate: "asc" }],
  });
  const horizon = addMonthsUTC(today, 14);
  return {
    today,
    schedules: schedules.map(({ overrides, executions, ...s }) => {
      const upcoming = projectSchedule({ ...s, overrides, executions }, addDaysUTC(today, 1), horizon)
        .filter((o) => o.status === "SCHEDULED" || o.status === "SKIPPED")
        .slice(0, 12);
      const history = executions.slice(0, 24).map((x) => ({
        id: x.id,
        occurrenceDate: x.occurrenceDate,
        date: x.executedDate,
        amount: Number(x.amount),
        status: x.status,
        note: x.note,
        failureReason: x.failureReason,
      }));
      return { ...s, amount: Number(s.amount), upcoming, history };
    }),
  };
});

export const POST = authed(async (req, { userId }) => {
  const input = await parseJson(req, createScheduleSchema);
  const schedule = await createSchedule(userId, {
    ...input,
    categoryId: input.categoryId ?? null,
    customIntervalDays: input.customIntervalDays ?? null,
    endDate: input.endDate ?? null,
    notes: input.notes ?? null,
    overrides: input.overrides?.map((o) => ({ occurrenceDate: o.occurrenceDate, date: o.date ?? null, amount: o.amount ?? null })),
  });
  // A start date of today or earlier is due immediately.
  const due = await runDueSchedules(new Date(), userId);
  return Response.json({ schedule, due }, { status: 201 });
});
