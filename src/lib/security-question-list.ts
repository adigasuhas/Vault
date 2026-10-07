/**
 * Secret questions for account recovery. A mix of the classic ones and a few
 * lighter ones people actually remember. Stored by id so wording can be
 * polished later without breaking anyone's recovery.
 */
export const SECURITY_QUESTIONS = [
  { id: "first-school", text: "What was the name of your first school?" },
  { id: "first-pet", text: "What was your first pet's name?" },
  { id: "birth-city", text: "In which city were you born?" },
  { id: "childhood-nickname", text: "What was your childhood nickname?" },
  { id: "first-crush", text: "Who was your first crush?" },
  { id: "childhood-cartoon", text: "What was your favourite cartoon as a child?" },
  { id: "school-snack", text: "What was your go-to snack at school?" },
  { id: "first-obsession", text: "What was the first film or concert you were obsessed with?" },
  { id: "fictional-character", text: "Who is your favourite fictional character?" },
  { id: "week-of-food", text: "What food could you eat for a week without complaining?" },
  { id: "homework-excuse", text: "What was your most-used excuse for not doing homework?" },
] as const;

export type SecurityQuestionId = (typeof SECURITY_QUESTIONS)[number]["id"];
export const QUESTION_IDS = SECURITY_QUESTIONS.map((q) => q.id) as [SecurityQuestionId, ...SecurityQuestionId[]];

export function questionText(id: string | null | undefined) {
  return SECURITY_QUESTIONS.find((q) => q.id === id)?.text ?? null;
}
