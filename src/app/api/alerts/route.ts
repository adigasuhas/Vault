import { db } from "@/lib/db";
import { authed } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Price-alert notifications, newest first (dismissed ones kept as history
 * but left out unless ?history=1), with the unread count. */
export const GET = authed(async (req, { userId }) => {
  const history = req.nextUrl.searchParams.get("history") === "1";
  const holdingId = req.nextUrl.searchParams.get("stock");
  const [events, unread] = await Promise.all([
    db.priceAlertEvent.findMany({
      where: { userId, ...(history ? {} : { dismissedAt: null }), ...(holdingId ? { stockHoldingId: holdingId } : {}) },
      orderBy: { createdAt: "desc" },
      take: history ? 200 : 30,
    }),
    db.priceAlertEvent.count({ where: { userId, readAt: null, dismissedAt: null } }),
  ]);
  return { events, unread };
});
