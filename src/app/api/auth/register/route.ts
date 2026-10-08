import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/crypto";
import { setSessionCookie } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { QUESTION_IDS, hashAnswer, normaliseAnswer } from "@/lib/security-questions";

export const dynamic = "force-dynamic";

const schema = z
  .object({
    name: z.string().trim().min(1, "Tell us what to call you.").max(120),
    email: z.string().trim().toLowerCase().email("That email doesn't look right."),
    password: z.string().min(10, "Use at least 10 characters.").max(200),
    confirmPassword: z.string(),
    securityQuestion: z.enum(QUESTION_IDS, { error: "Pick a secret question." }),
    securityAnswer: z.string().max(200).refine((a) => normaliseAnswer(a).length >= 2, "Give an answer with at least 2 letters or numbers."),
  })
  .refine((v) => v.password === v.confirmPassword, { message: "The passwords don't match.", path: ["confirmPassword"] });

/** Whether sign-up is open (the UI hides "Create account" when it isn't). */
export async function GET() {
  return NextResponse.json({ open: process.env.ALLOW_SIGNUP !== "false" });
}

/** Self-service sign-up. Disable with ALLOW_SIGNUP=false (e.g. a private
 * single-user install); accounts can then only be created by a developer. */
export async function POST(req: NextRequest) {
  if (process.env.ALLOW_SIGNUP === "false") {
    return NextResponse.json({ error: "Sign-ups are closed on this VAULT. Ask the owner for an account." }, { status: 403 });
  }
  const limit = await rateLimit(`register:ip:${clientIp(req)}`, 5, 60 * 60 * 1000);
  if (!limit.ok) {
    return NextResponse.json({ error: "Too many sign-ups from here. Try again in a while." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: first?.message ?? "Check the form and try again.", fieldErrors: Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])) },
      { status: 422 }
    );
  }
  const { name, email, password, securityQuestion, securityAnswer } = parsed.data;
  if (password.toLowerCase().includes(email.split("@")[0]) && email.split("@")[0].length >= 4) {
    return NextResponse.json({ error: "Pick a password that isn't based on your email.", fieldErrors: { password: "Too close to your email." } }, { status: 422 });
  }
  const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    return NextResponse.json({ error: "There's already an account with this email. Sign in instead.", fieldErrors: { email: "Already registered." } }, { status: 409 });
  }
  const user = await db.user.create({
    data: {
      email,
      name,
      passwordHash: hashPassword(password),
      securityQuestion,
      securityAnswerHash: hashAnswer(securityAnswer),
      isOnboarded: false,
    },
  });
  await setSessionCookie({ userId: user.id, email: user.email, name: user.name ?? undefined, tv: user.tokenVersion });
  return NextResponse.json(
    { user: { ...user, passwordHash: undefined, securityAnswerHash: undefined, isDeveloper: false } },
    { status: 201 }
  );
}
