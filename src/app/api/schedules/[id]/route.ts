import { db } from "@/lib/db";
import { authed, notFound } from "@/lib/api";
import { parseJson } from "@/lib/validate";
import { patchScheduleSchema } from "@/lib/schemas";
import { deleteOrEndSchedule, projectSchedule, runDueSchedules, updateSchedule, userToday } from "@/lib/schedules";
import { addMonthsUTC } from "@/lib/dates";

export const dynamic = "force-dynamic";

/** One schedule with its occurrences from 12 months back to 18 ahead. */
export const GET = authed<{ id: string }>(async (_req, { userId, params }) => {
  const s = await db.scheduledCredit.findFirst({
    where: { id: params.id, userId },
    include: {
      overrides: true,
      executions: true,
      receivingAccount: { select: { id: true, name: true, currency: true } },
      category: { select: { id: true, name: true } },
    },
  });
  if (!s) return notFound("Schedule not found.");
  const today = await userToday(userId);
  const occurrences = projectSchedule(s, addMonthsUTC(today, -12), addMonthsUTC(today, 18));
  const audit = await db.auditEvent.findMany({ where: { userId, entityId: s.id }, orderBy: { createdAt: "desc" }, take: 30 });
  const schedule = { ...s, amount: Number(s.amount), overrides: undefined, executions: undefined };
  return { schedule, occurrences, audit, today };
});

export const PATCH = authed<{ id: string }>(async (req, { userId, params }) => {
  const input = await parseJson(req, patchScheduleSchema);
  const schedule = await updateSchedule(userId, params.id, input);
  await runDueSchedules(new Date(), userId);
  return { schedule };
});

/** Deletes a schedule that never ran; otherwise ends it and keeps history. */
export const DELETE = authed<{ id: string }>(async (_req, { userId, params }) => deleteOrEndSchedule(userId, params.id));
