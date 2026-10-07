import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { verifyChallenge } from "@/lib/auth";
import { hashPassword } from "@/lib/crypto";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { verifyAnswer } from "@/lib/security-questions";

export const dynamic = "force-dynamic";

const schema = z.object({ challenge: z.string().min(10), answer: z.string().max(200) });
const MAX_ATTEMPTS = 5;
const LOCK_MS = 30 * 60 * 1000;
const RESET_TTL_MS = 15 * 60 * 1000;
// Verifying against this keeps wrong-account timing similar to a real check.
const DUMMY_HASH = hashPassword("dummy-answer-for-timing");

const WRONG = "That answer doesn't match. Check the spelling and try again.";

/**
 * Step 2: checks the secret answer. Only a correct answer yields a one-time,
 * 15-minute reset token (stored hashed, same as the email flow), which
 * /api/auth/reset-password exchanges for a new password. Five wrong answers
 * lock recovery for the account for 30 minutes.
 */
export async function POST(req: NextRequest) {
  if (!rateLimit(`recovery-verify:ip:${clientIp(req)}`, 15, 15 * 60 * 1000).ok) {
    return NextResponse.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter your answer." }, { status: 422 });

  const claims = await verifyChallenge<{ sub: string | null; email: string }>(parsed.data.challenge);
  if (!claims) return NextResponse.json({ error: "This recovery session has expired. Start again." }, { status: 400 });

  if (!claims.sub) {
    verifyAnswer(parsed.data.answer, DUMMY_HASH);
    return NextResponse.json({ error: WRONG }, { status: 401 });
  }
  const user = await db.user.findUnique({ where: { id: claims.sub } });
  if (!user || !user.securityAnswerHash || user.status !== "ACTIVE" || user.deletedAt) {
    return NextResponse.json({ error: WRONG }, { status: 401 });
  }
  if (user.recoveryLockedUntil && user.recoveryLockedUntil > new Date()) {
    const mins = Math.ceil((user.recoveryLockedUntil.getTime() - Date.now()) / 60000);
    return NextResponse.json({ error: `Too many wrong answers. Try again in about ${mins} minute${mins === 1 ? "" : "s"}.` }, { status: 429 });
  }

  if (!verifyAnswer(parsed.data.answer, user.securityAnswerHash)) {
    // Atomic increment so parallel guesses can't slip past the limit.
    const { recoveryFailedAttempts: attempts } = await db.user.update({
      where: { id: user.id },
      data: { recoveryFailedAttempts: { increment: 1 } },
      select: { recoveryFailedAttempts: true },
    });
    if (attempts >= MAX_ATTEMPTS) {
      await db.user.update({ where: { id: user.id }, data: { recoveryFailedAttempts: 0, recoveryLockedUntil: new Date(Date.now() + LOCK_MS) } });
      return NextResponse.json({ error: "Too many wrong answers. Recovery is paused for 30 minutes." }, { status: 429 });
    }
    const left = MAX_ATTEMPTS - attempts;
    return NextResponse.json({ error: `${WRONG} ${left} ${left === 1 ? "try" : "tries"} left.` }, { status: 401 });
  }

  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  await db.$transaction([
    db.user.update({ where: { id: user.id }, data: { recoveryFailedAttempts: 0, recoveryLockedUntil: null } }),
    db.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } }),
    db.passwordResetToken.create({ data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + RESET_TTL_MS) } }),
  ]);
  return NextResponse.json({ resetToken: token });
}
