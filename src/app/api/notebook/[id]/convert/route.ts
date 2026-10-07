import { authed } from "@/lib/api";
import { parseJson } from "@/lib/validate";
import { convertNotebookEntrySchema } from "@/lib/schemas";
import { convertToExpense, convertToReceivable } from "@/lib/notebook";

export const dynamic = "force-dynamic";

/** POST { to: "EXPENSE", accountId, categoryId, date? } | { to: "RECEIVABLE", accountId, date }.
 * Loans are made through POST /api/loans with `notebookEntryId`. */
export const POST = authed<{ id: string }>(async (req, { userId, params }) => {
  const input = await parseJson(req, convertNotebookEntrySchema);
  if (input.to === "EXPENSE") {
    const expense = await convertToExpense(userId, params.id, input);
    return { expense };
  }
  const schedule = await convertToReceivable(userId, params.id, input);
  return { schedule };
});
