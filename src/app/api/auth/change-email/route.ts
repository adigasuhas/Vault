import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionUser, revokeUserSessions, setSessionCookie } from "@/lib/auth";
import { verifyPassword } from "@/lib/crypto";
import { rateLimit } from "@/lib/rate-limit";
import { audit, type Tx } from "@/lib/ledger";

export const dynamic = "force-dynamic";

const schema = z.object({
  newEmail: z.string().trim().toLowerCase().email("That email doesn't look right.").max(254),
  currentPassword: z.string().max(200),
});

/** Changes the sign-in email. Needs the current password; other devices are
 * signed out, this one gets a fresh session. */
export async function POST(req: NextRequest) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const limit = await rateLimit(`change-email:${session.userId}`, 5, 15 * 60 * 1000);
  if (!limit.ok) {
    return NextResponse.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  const { newEmail, currentPassword } = parsed.data;

  const user = await db.user.findUnique({ where: { id: session.userId } });
  if (!user) return NextResponse.json({ error: "User not found." }, { status: 404 });
  if (newEmail === user.email) return NextResponse.json({ error: "That's already your email." }, { status: 400 });
  // The built-in developer login is tied to DEV_USERNAME; renaming it would
  // orphan this account the next time the developer signs in.
  if (process.env.DEV_USERNAME && user.email === process.env.DEV_USERNAME.toLowerCase().trim()) {
    return NextResponse.json({ error: "The developer account's email comes from DEV_USERNAME. Change it there instead." }, { status: 400 });
  }
  if (!user.passwordHash || !verifyPassword(currentPassword, user.passwordHash)) {
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 401 });
  }
  if (await db.user.findUnique({ where: { email: newEmail }, select: { id: true } })) {
    return NextResponse.json({ error: "That email is already used by another account." }, { status: 409 });
  }

  try {
    await db.$transaction(async (tx: Tx) => {
      await tx.user.update({ where: { id: user.id }, data: { email: newEmail, emailVerifiedAt: null } });
      await audit(tx, user.id, "user", user.id, "user.email_change", "Changed sign-in email", { from: user.email, to: newEmail });
    });
  } catch {
    return NextResponse.json({ error: "That email is already used by another account." }, { status: 409 });
  }

  await revokeUserSessions(user.id);
  const fresh = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { tokenVersion: true } });
  await setSessionCookie({ userId: user.id, email: newEmail, name: user.name ?? undefined, tv: fresh.tokenVersion });
  return NextResponse.json({ success: true, email: newEmail });
}
