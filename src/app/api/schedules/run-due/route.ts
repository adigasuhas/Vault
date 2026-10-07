import { authed } from "@/lib/api";
import { runDueSchedules } from "@/lib/schedules";

export const dynamic = "force-dynamic";

/** Brings the signed-in user's schedules up to date (the daily cron does this
 * for everyone; pages call it on load so nothing waits a day to show). */
export const POST = authed(async (_req, { userId }) => runDueSchedules(new Date(), userId));
