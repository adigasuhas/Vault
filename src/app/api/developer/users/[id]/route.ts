import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireDeveloper, revokeUserSessions } from "@/lib/auth";
import { hashPassword } from "@/lib/crypto";
import { auditAdminAction } from "@/lib/audit";
import { deleteUserData } from "@/lib/user-delete";
import { toAdminUser } from "@/lib/admin-user";

export const dynamic = "force-dynamic";

const ROLES = new Set(["USER", "DEVELOPER"]);
const STATUSES = new Set(["ACTIVE", "SUSPENDED", "DISABLED"]);

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const developer = await requireDeveloper(req);
  if (!developer) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const { id } = await context.params;

  const target = await db.user.findUnique({ where: { id } });
  if (!target) return NextResponse.json({ error: "User not found." }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const { name, role, status, password } = body;

  if (role !== undefined && !ROLES.has(role)) {
    return NextResponse.json({ error: "role must be USER or DEVELOPER." }, { status: 400 });
  }
  if (status !== undefined && !STATUSES.has(status)) {
    return NextResponse.json({ error: "status must be ACTIVE, SUSPENDED or DISABLED." }, { status: 400 });
  }
  if (password !== undefined && (typeof password !== "string" || password.length < 10)) {
    return NextResponse.json({ error: "password must be at least 10 characters." }, { status: 400 });
  }

  // Never leave the instance with no way in.
  const demotingLastDeveloper =
    target.role === "DEVELOPER" &&
    ((role !== undefined && role !== "DEVELOPER") || (status !== undefined && status !== "ACTIVE"));
  if (demotingLastDeveloper) {
    const otherActiveDevs = await db.user.count({
      where: { role: "DEVELOPER", status: "ACTIVE", deletedAt: null, id: { not: id } },
    });
    if (otherActiveDevs === 0) {
      return NextResponse.json(
        { error: "This is the last active developer account. Promote someone else first." },
        { status: 409 }
      );
    }
  }

  const user = await db.user.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(role !== undefined ? { role } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(password ? { passwordHash: hashPassword(password) } : {}),
      ...(status === "ACTIVE" ? { failedLoginAttempts: 0, lockedUntil: null } : {}),
    },
  });

  // A status change away from ACTIVE, a role change, or a password reset must
  // invalidate the target's existing sessions immediately.
  if ((status !== undefined && status !== "ACTIVE") || role !== undefined || password) {
    await revokeUserSessions(id);
  }

  const changed = [
    name !== undefined && "name",
    role !== undefined && `role→${role}`,
    status !== undefined && `status→${status}`,
    password && "password reset",
  ].filter(Boolean);
  await auditAdminAction({
    actorId: developer.id,
    action: "user.update",
    targetUserId: id,
    detail: `${target.email}: ${changed.join(", ") || "no changes"}`,
    req,
  });

  return NextResponse.json({ user: toAdminUser(user) });
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const developer = await requireDeveloper(req);
  if (!developer) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const { id } = await context.params;

  if (id === developer.id) {
    return NextResponse.json({ error: "You cannot delete your own account." }, { status: 400 });
  }

  const target = await db.user.findUnique({ where: { id } });
  if (!target) return NextResponse.json({ error: "User not found." }, { status: 404 });

  if (target.role === "DEVELOPER") {
    const otherActiveDevs = await db.user.count({
      where: { role: "DEVELOPER", status: "ACTIVE", deletedAt: null, id: { not: id } },
    });
    if (otherActiveDevs === 0) {
      return NextResponse.json(
        { error: "This is the last active developer account. Promote someone else before deleting it." },
        { status: 409 }
      );
    }
  }

  await deleteUserData(id);
  await auditAdminAction({
    actorId: developer.id,
    action: "user.delete",
    targetUserId: null,
    detail: `deleted ${target.email} (${target.role})`,
    req,
  });
  return NextResponse.json({ success: true });
}
