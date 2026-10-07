import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword, needsRehash } from "@/lib/crypto";
import { setSessionCookie } from "@/lib/auth";
import { ensureDevDemoData } from "@/lib/defaults";
import { rateLimit, rateLimitReset, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// Developer sign-in is only available when BOTH env vars are set. There is no
// hardcoded fallback — an unset DEV_USERNAME/DEV_PASSWORD simply disables the
// path entirely.
function devCredentials(): { email: string; password: string } | null {
  const email = process.env.DEV_USERNAME?.toLowerCase().trim();
  const password = process.env.DEV_PASSWORD;
  if (!email || !password) return null;
  return { email, password };
}

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Still do a comparison to keep timing roughly constant.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

async function findOrCreateDevUser(devEmail: string) {
  let user = await db.user.findUnique({ where: { email: devEmail } });

  if (!user) {
    const totalUsers = await db.user.count();
    user = await db.user.create({
      data: {
        email: devEmail,
        name: "Developer",
        role: "DEVELOPER",
        isOnboarded: true,
      },
    });
    await ensureDevDemoData(user.id, user.baseCurrency);
    return { user, showCreateFirstUser: totalUsers === 0 };
  }

  const otherUsers = await db.user.count({ where: { id: { not: user.id } } });
  return { user, showCreateFirstUser: otherUsers === 0 };
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const email = (body?.email || "").toLowerCase().trim();
  const password = body?.password || "";

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  // Rate limit: 8 attempts / 10 min per IP, and 5 / 10 min per account.
  const ip = clientIp(req);
  const windowMs = 10 * 60 * 1000;
  const ipLimit = rateLimit(`login:ip:${ip}`, 8, windowMs);
  const emailLimit = rateLimit(`login:email:${email}`, 5, windowMs);
  if (!ipLimit.ok || !emailLimit.ok) {
    const retryAfter = Math.max(ipLimit.retryAfterSeconds, emailLimit.retryAfterSeconds);
    return NextResponse.json(
      { error: "Too many sign-in attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }

  const dev = devCredentials();
  if (dev && email === dev.email) {
    if (!constantTimeEqual(password, dev.password)) {
      return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
    }
    const { user, showCreateFirstUser } = await findOrCreateDevUser(dev.email);
    await setSessionCookie({ userId: user.id, email: user.email, name: user.name ?? undefined, tv: user.tokenVersion });
    await db.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });
    rateLimitReset(`login:ip:${ip}`);
    rateLimitReset(`login:email:${email}`);
    return NextResponse.json({
      user: { ...user, passwordHash: undefined, securityAnswerHash: undefined, recoveryFailedAttempts: undefined, recoveryLockedUntil: undefined, isDeveloper: true, showCreateFirstUser },
    });
  }

  const user = await db.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  if (user.status === "SUSPENDED" || user.status === "DISABLED") {
    return NextResponse.json({ error: "This account has been suspended." }, { status: 403 });
  }

  // Account lockout after repeated failures (in addition to the per-request
  // rate limit, which is in-memory and per-instance).
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    return NextResponse.json(
      { error: `Too many failed attempts. This account is locked for about ${mins} more minute(s).` },
      { status: 429 }
    );
  }

  if (!verifyPassword(password, user.passwordHash)) {
    const attempts = user.failedLoginAttempts + 1;
    const MAX = 8;
    await db.user.update({
      where: { id: user.id },
      data:
        attempts >= MAX
          ? { failedLoginAttempts: 0, lockedUntil: new Date(Date.now() + 15 * 60 * 1000) }
          : { failedLoginAttempts: attempts },
    });
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  // Transparently upgrade legacy PBKDF2 hashes to scrypt on successful login.
  if (needsRehash(user.passwordHash)) {
    await db.user
      .update({ where: { id: user.id }, data: { passwordHash: hashPassword(password) } })
      .catch(() => {});
  }

  await setSessionCookie({ userId: user.id, email: user.email, name: user.name ?? undefined, tv: user.tokenVersion });
  await db.user.update({
    where: { id: user.id },
    data: { lastLogin: new Date(), failedLoginAttempts: 0, lockedUntil: null },
  });
  rateLimitReset(`login:ip:${ip}`);
  rateLimitReset(`login:email:${email}`);

  return NextResponse.json({
    user: { ...user, passwordHash: undefined, securityAnswerHash: undefined, recoveryFailedAttempts: undefined, recoveryLockedUntil: undefined, isDeveloper: user.role === "DEVELOPER" },
  });
}
