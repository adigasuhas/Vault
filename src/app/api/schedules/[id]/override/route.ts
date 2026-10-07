import { authed } from "@/lib/api";
import { parseJson } from "@/lib/validate";
import { overrideSchema } from "@/lib/schemas";
import { runDueSchedules, setOverride } from "@/lib/schedules";

export const dynamic = "force-dynamic";

/** Moves / re-prices one upcoming occurrence. Send `date: null, amount: null`
 * to clear the override. */
export const PUT = authed<{ id: string }>(async (req, { userId, params }) => {
  const input = await parseJson(req, overrideSchema);
  await setOverride(userId, params.id, input.occurrenceDate, { date: input.date ?? null, amount: input.amount ?? null });
  await runDueSchedules(new Date(), userId);
  return { ok: true };
});
