import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ authenticated: false, user: null });
  }

  const isDeveloper = user.role === "DEVELOPER";
  const otherUsers = isDeveloper ? await db.user.count({ where: { id: { not: user.id } } }) : 0;

  return NextResponse.json({
    authenticated: true,
    user: {
      ...user,
      passwordHash: undefined,
      securityAnswerHash: undefined,
      recoveryFailedAttempts: undefined,
      recoveryLockedUntil: undefined,
      isDeveloper,
      showCreateFirstUser: isDeveloper && otherUsers === 0,
    },
  });
}
