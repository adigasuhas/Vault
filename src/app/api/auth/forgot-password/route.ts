import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Retired: emailed reset links let anyone with inbox access skip the secret
 * question. Recovery now goes through /api/auth/recovery/{start,verify}. */
export async function POST() {
  return NextResponse.json({ error: "Password reset now uses your secret question. Start again from the Forgot password page." }, { status: 410 });
}
