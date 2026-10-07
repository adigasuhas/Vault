import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, clearSessionCookie } from "@/lib/auth";
import { verifyPassword } from "@/lib/crypto";
import { deleteUserData } from "@/lib/user-delete";

export const dynamic = "force-dynamic";

/**
 * Self-service account deletion (finding R6). Hard-deletes the user and every
 * related row (Prisma cascades handle it) and clears the session. Requires the
 * account password. A DEVELOPER can't delete themselves this way if they're the
 * last one.
 */
export async function DELETE(req: NextRequest) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const password = typeof body?.password === "string" ? body.password : "";
  const confirm = body?.confirm;

  const user = await db.user.findUnique({ where: { id: session.userId } });
  if (!user) return NextResponse.json({ error: "User not found." }, { status: 404 });

  if (confirm !== "DELETE") {
    return NextResponse.json({ error: 'Type "DELETE" to confirm.' }, { status: 400 });
  }
  if (user.passwordHash) {
    if (!password || !verifyPassword(password, user.passwordHash)) {
      return NextResponse.json({ error: "Password is incorrect." }, { status: 401 });
    }
  }

  if (user.role === "DEVELOPER") {
    const otherDevs = await db.user.count({
      where: { role: "DEVELOPER", status: "ACTIVE", deletedAt: null, id: { not: user.id } },
    });
    if (otherDevs === 0) {
      return NextResponse.json(
        { error: "You're the last Developer account. Promote another user before deleting yours." },
        { status: 409 }
      );
    }
  }

  await deleteUserData(user.id);
  await clearSessionCookie();
  return NextResponse.json({ success: true });
}
