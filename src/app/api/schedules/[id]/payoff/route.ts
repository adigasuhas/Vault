import { z } from "zod";
import { authed } from "@/lib/api";
import { parseJson, zId, zIsoDate } from "@/lib/validate";
import { payOffSchedule, runDueSchedules, scheduleRemaining, userToday } from "@/lib/schedules";

export const dynamic = "force-dynamic";

/** What's still to pay on the schedule: { count, total, currency }. */
export const GET = authed<{ id: string }>(async (_req, { userId, params }) => {
  await runDueSchedules(new Date(), userId);
  return scheduleRemaining(userId, params.id);
});

const schema = z.object({ accountId: zId.optional(), date: zIsoDate.optional() });

/** Pays everything left in one go and ends the schedule. */
export const POST = authed<{ id: string }>(async (req, { userId, params }) => {
  const input = await parseJson(req, schema);
  await runDueSchedules(new Date(), userId);
  return payOffSchedule(userId, params.id, { accountId: input.accountId, date: input.date ?? (await userToday(userId)) });
});
