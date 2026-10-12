import { z } from "zod";
import { db } from "@/lib/db";
import { authed } from "@/lib/api";
import { parseJson, ValidationError } from "@/lib/validate";

export const dynamic = "force-dynamic";

const schema = z.object({ read: z.boolean().optional(), dismissed: z.boolean().optional() });

/** Marks a notification read or unread, or dismisses it (kept in history). */
export const PATCH = authed<{ id: string }>(async (req, { userId, params }) => {
  const input = await parseJson(req, schema);
  const e = await db.priceAlertEvent.findFirst({ where: { id: params.id, userId } });
  if (!e) throw new ValidationError("Notification not found.");
  const now = new Date();
  const event = await db.priceAlertEvent.update({
    where: { id: e.id },
    data: {
      ...(input.read !== undefined ? { readAt: input.read ? e.readAt ?? now : null } : {}),
      ...(input.dismissed !== undefined ? { dismissedAt: input.dismissed ? now : null, ...(input.dismissed ? { readAt: e.readAt ?? now } : {}) } : {}),
    },
  });
  return { event };
});
