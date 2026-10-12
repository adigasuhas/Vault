import { db } from "@/lib/db";
import { authed } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Marks every notification read. */
export const POST = authed(async (_req, { userId }) => {
  const r = await db.priceAlertEvent.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
  return { updated: r.count };
});
