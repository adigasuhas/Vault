import { db } from "@/lib/db";
import { authed } from "@/lib/api";
import { parseJson, ValidationError } from "@/lib/validate";
import { patchNotebookEntrySchema } from "@/lib/schemas";
import { dateOnly } from "@/lib/dates";

export const dynamic = "force-dynamic";

async function load(userId: string, id: string) {
  const entry = await db.notebookEntry.findFirst({ where: { id, userId } });
  if (!entry) throw new ValidationError("Notebook entry not found.");
  return entry;
}

/** Edits an entry. Converted ones are frozen: what they became is the record now. */
export const PATCH = authed<{ id: string }>(async (req, { userId, params }) => {
  const entry = await load(userId, params.id);
  const input = await parseJson(req, patchNotebookEntrySchema);
  if (entry.status !== "OPEN") throw new ValidationError("This entry was already turned into something else, so it can't be changed.");
  if (input.projectId && !(await db.expenseProject.findFirst({ where: { id: input.projectId, userId } }))) {
    throw new ValidationError("Group not found.");
  }
  const updated = await db.notebookEntry.update({
    where: { id: entry.id },
    data: {
      title: input.title,
      amount: input.amount,
      currency: input.currency,
      date: input.date ? dateOnly(input.date) : undefined,
      paidBy: input.paidBy,
      person: input.person,
      notes: input.notes,
      projectId: input.projectId,
    },
  });
  return { entry: updated };
});

/** Notebook entries are planning notes, not money records: deleting one is final. */
export const DELETE = authed<{ id: string }>(async (_req, { userId, params }) => {
  const entry = await load(userId, params.id);
  if (entry.status !== "OPEN") throw new ValidationError("This entry was already turned into something else. Remove that instead.");
  await db.notebookEntry.delete({ where: { id: entry.id } });
  return { ok: true };
});
