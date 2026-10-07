import { z } from "zod";
import { db } from "@/lib/db";
import { authed } from "@/lib/api";
import { verifyPassword } from "@/lib/crypto";
import { parseJson, ValidationError } from "@/lib/validate";
import { QUESTION_IDS, hashAnswer, normaliseAnswer, questionText } from "@/lib/security-questions";

export const dynamic = "force-dynamic";

/** Which question is set (never the answer). */
export const GET = authed(async (_req, { userId }) => {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { securityQuestion: true, securityAnswerHash: true } });
  return { question: u.securityAnswerHash ? u.securityQuestion : null, questionText: u.securityAnswerHash ? questionText(u.securityQuestion) : null };
});

const schema = z.object({
  question: z.enum(QUESTION_IDS),
  answer: z.string().max(200).refine((a) => normaliseAnswer(a).length >= 2, "Give an answer with at least 2 letters or numbers."),
  currentPassword: z.string().min(1, "Enter your current password."),
});

/** Sets or changes the secret question. Needs the current password. */
export const POST = authed(async (req, { userId }) => {
  const input = await parseJson(req, schema);
  const u = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true } });
  if (!u.passwordHash || !verifyPassword(input.currentPassword, u.passwordHash)) throw new ValidationError("Your current password isn't right.");
  await db.user.update({
    where: { id: userId },
    data: { securityQuestion: input.question, securityAnswerHash: hashAnswer(input.answer), recoveryFailedAttempts: 0, recoveryLockedUntil: null },
  });
  return { ok: true };
});
