import crypto from "crypto";
import { hashPassword, verifyPassword } from "@/lib/crypto";

import { SECURITY_QUESTIONS } from "@/lib/security-question-list";
export { SECURITY_QUESTIONS, QUESTION_IDS, questionText, type SecurityQuestionId } from "@/lib/security-question-list";

/** Case, spacing and punctuation don't matter: "Mr. Whiskers " = "mr whiskers". */
export function normaliseAnswer(answer: string) {
  return answer
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function hashAnswer(answer: string) {
  return hashPassword(normaliseAnswer(answer));
}

export function verifyAnswer(answer: string, stored: string) {
  return verifyPassword(normaliseAnswer(answer), stored);
}

/** A plausible question for an email with no (eligible) account, so the
 * response looks the same either way and can't be used to find accounts.
 * Deterministic per email, so asking twice shows the same question. */
export function decoyQuestion(email: string) {
  const n = crypto.createHash("sha256").update(`decoy:${email}`).digest()[0];
  return SECURITY_QUESTIONS[n % SECURITY_QUESTIONS.length];
}
