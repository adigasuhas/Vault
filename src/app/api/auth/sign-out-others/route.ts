import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, revokeUserSessions, setSessionCookie } from "@/lib/auth";
import { audit, type Tx } from "@/lib/ledger";

export const dynamic = "force-dynamic";

/** Signs out every other device: all sessions are invalidated and this one
 * gets a fresh cookie, so it stays signed in. */
export async function POST() {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  await revokeUserSessions(session.userId);
  const user = await db.user.findUniqueOrThrow({ where: { id: session.userId }, select: { email: true, name: true, tokenVersion: true } });
  await setSessionCookie({ userId: session.userId, email: user.email, name: user.name ?? undefined, tv: user.tokenVersion });
  await db.$transaction((tx: Tx) => audit(tx, session.userId, "user", session.userId, "user.sign_out_others", "Signed out of every other device"));
  return NextResponse.json({ success: true });
}
