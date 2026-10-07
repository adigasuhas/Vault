import { authed } from "@/lib/api";
import { loadOccurrences, userToday } from "@/lib/schedules";
import { addMonthsUTC, monthRange } from "@/lib/dates";
import { queryDate } from "@/lib/validate";

export const dynamic = "force-dynamic";

/** Occurrences (stored + projected) in a window.
 *  `?month=YYYY-MM` or `?from&to`; `?direction`; `?status=PENDING,FAILED`. */
export const GET = authed(async (req, { userId }) => {
  const sp = req.nextUrl.searchParams;
  const today = await userToday(userId);
  let from = addMonthsUTC(today, -24);
  let to = addMonthsUTC(today, 12);
  const month = sp.get("month");
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const r = monthRange(month);
    from = r.start;
    to = new Date(r.end.getTime() - 86_400_000);
  } else {
    from = queryDate(sp, "from") ?? from;
    to = queryDate(sp, "to") ?? to;
  }
  const direction = sp.get("direction");
  const statuses = sp.get("status")?.split(",").filter(Boolean);
  let occurrences = await loadOccurrences(userId, from, to, {
    direction: direction === "INCOME" || direction === "PAYMENT" ? direction : undefined,
  });
  if (statuses?.length) occurrences = occurrences.filter((o) => statuses.includes(o.status));
  return { occurrences, today };
});
