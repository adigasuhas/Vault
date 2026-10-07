import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { signChallenge } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { decoyQuestion, questionText } from "@/lib/security-questions";

export const dynamic = "force-dynamic";

const schema = z.object({ email: z.string().trim().toLowerCase().email("Enter the email you signed up with.") });

/**
 * Step 1 of password recovery: returns the account's secret question and a
 * signed 10-minute challenge for step 2. Unknown emails (and accounts without
 * a question) get a believable decoy question and a challenge that can never
 * succeed, so the response doesn't reveal whether an account exists.
 */
export async function POST(req: NextRequest) {
  if (!rateLimit(`recovery-start:ip:${clientIp(req)}`, 10, 15 * 60 * 1000).ok) {
    return NextResponse.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter your email." }, { status: 422 });
  const { email } = parsed.data;

  const user = await db.user.findUnique({ where: { email }, select: { id: true, status: true, deletedAt: true, securityQuestion: true, securityAnswerHash: true } });
  const eligible = user && user.status === "ACTIVE" && !user.deletedAt && user.securityAnswerHash && questionText(user.securityQuestion);
  const question = eligible ? questionText(user!.securityQuestion)! : decoyQuestion(email).text;
  const challenge = await signChallenge({ sub: eligible ? user!.id : null, email });
  return NextResponse.json({ question, challenge });
}
