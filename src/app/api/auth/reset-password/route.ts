import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/crypto";
import { revokeUserSessions } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!(await rateLimit(`reset:ip:${clientIp(req)}`, 10, 15 * 60 * 1000)).ok) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token : "";
  const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";

  if (!token) return NextResponse.json({ error: "Missing reset token." }, { status: 400 });
  if (newPassword.length < 10) {
    return NextResponse.json({ error: "Use at least 10 characters." }, { status: 400 });
  }
  if (typeof body?.confirmPassword === "string" && body.confirmPassword !== newPassword) {
    return NextResponse.json({ error: "The passwords don't match." }, { status: 400 });
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const record = await db.passwordResetToken.findUnique({ where: { tokenHash }, include: { user: true } });

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    return NextResponse.json({ error: "This reset has expired or was already used. Start again." }, { status: 400 });
  }

  await db.$transaction([
    db.user.update({ where: { id: record.userId }, data: { passwordHash: hashPassword(newPassword), failedLoginAttempts: 0, lockedUntil: null } }),
    db.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    db.passwordResetToken.deleteMany({ where: { userId: record.userId, usedAt: null } }),
  ]);
  await revokeUserSessions(record.userId);

  return NextResponse.json({ ok: true });
}
