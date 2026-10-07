import { authed } from "@/lib/api";
import { parseJson } from "@/lib/validate";
import { skipAheadSchema } from "@/lib/schemas";
import { skipOccurrence } from "@/lib/schedules";

export const dynamic = "force-dynamic";

/** Skips an upcoming occurrence ahead of time (e.g. rent waived in May). */
export const POST = authed<{ id: string }>(async (req, { userId, params }) => {
  const input = await parseJson(req, skipAheadSchema);
  const occurrence = await skipOccurrence(userId, { scheduleId: params.id, occurrenceDate: input.occurrenceDate }, input.note);
  return { occurrence };
});
