import { db } from "@/lib/db";
import { authed } from "@/lib/api";
import { parseJson, parseOrThrow, ValidationError } from "@/lib/validate";
import { deleteNotebookSchema, notebookSchema } from "@/lib/schemas";
import { assertNotebookNameFree, deleteNotebook } from "@/lib/notebooks";

export const dynamic = "force-dynamic";

/** Renames a notebook. */
export const PATCH = authed<{ id: string }>(async (req, { userId, params }) => {
  const { name } = await parseJson(req, notebookSchema);
  const nb = await db.notebook.findFirst({ where: { id: params.id, userId } });
  if (!nb) throw new ValidationError("Notebook not found.");
  await assertNotebookNameFree(userId, name, nb.id);
  const notebook = await db.notebook.update({ where: { id: nb.id }, data: { name } });
  return { notebook };
});

/** Deletes a notebook. With entries, the body says what happens to them:
 * `{ moveTo: <notebook id> }` or `{ deleteEntries: true }`. */
export const DELETE = authed<{ id: string }>(async (req, { userId, params }) => {
  const body = await req.json().catch(() => ({}));
  const input = parseOrThrow(deleteNotebookSchema, body ?? {});
  return deleteNotebook(userId, params.id, { moveTo: input.moveTo ?? null, deleteEntries: input.deleteEntries ?? false });
});
