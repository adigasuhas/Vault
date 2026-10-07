import { db } from "@/lib/db";
import { clientIp } from "@/lib/rate-limit";

/**
 * Records a privileged (DEVELOPER-role) action for the admin audit trail
 * (finding F26). Best-effort: a logging failure must never block the action.
 */
export async function auditAdminAction(input: {
  actorId: string;
  action: string;
  targetUserId?: string | null;
  detail?: string;
  req?: Request;
}) {
  try {
    await db.adminAuditLog.create({
      data: {
        actorId: input.actorId,
        action: input.action,
        targetUserId: input.targetUserId ?? null,
        detail: input.detail,
        ip: input.req ? clientIp(input.req) : null,
      },
    });
  } catch (err) {
    console.error("auditAdminAction failed:", err);
  }
}
