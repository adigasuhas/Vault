import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, revokeUserSessions, setSessionCookie } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/crypto";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const currentPassword = body?.currentPassword || "";
  const newPassword = body?.newPassword || "";

  if (!newPassword || newPassword.length < 10) {
    return NextResponse.json({ error: "New password must be at least 10 characters." }, { status: 400 });
  }
  if (newPassword === currentPassword) {
    return NextResponse.json({ error: "The new password must be different from the current one." }, { status: 400 });
  }

  const user = await db.user.findUnique({ where: { id: session.userId } });
  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  if (user.passwordHash && !verifyPassword(currentPassword, user.passwordHash)) {
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 401 });
  }

  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: hashPassword(newPassword) },
  });

  // Invalidate every other session, then re-issue a fresh cookie for this one so
  // the user isn't signed out of the device they just changed the password on.
  await revokeUserSessions(user.id);
  const fresh = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { tokenVersion: true } });
  await setSessionCookie({ userId: user.id, email: user.email, name: user.name ?? undefined, tv: fresh.tokenVersion });

  return NextResponse.json({ success: true });
}
