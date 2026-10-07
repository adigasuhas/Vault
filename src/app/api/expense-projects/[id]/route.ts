import { db } from "@/lib/db";
import { authed, notFound } from "@/lib/api";
import { parseJson, ValidationError } from "@/lib/validate";
import { updateExpenseProjectSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

/** Rename, edit the note, or archive (hide from pickers) a group. */
export const PATCH = authed<{ id: string }>(async (req, { userId, params }) => {
  const input = await parseJson(req, updateExpenseProjectSchema);
  const project = await db.expenseProject.findFirst({ where: { id: params.id, userId } });
  if (!project) return notFound("Group not found.");
  if (input.name && input.name.toLowerCase() !== project.name.toLowerCase()) {
    const clash = await db.expenseProject.findFirst({ where: { userId, name: { equals: input.name, mode: "insensitive" }, NOT: { id: project.id } } });
    if (clash) throw new ValidationError(`You already have a group called "${clash.name}".`);
  }
  const updated = await db.expenseProject.update({
    where: { id: project.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.archived !== undefined ? { archivedAt: input.archived ? new Date() : null } : {}),
    },
  });
  return { project: updated };
});

/** Only an empty group can be deleted; one with purchases (even removed
 * ones, which stay on record) can be archived instead. */
export const DELETE = authed<{ id: string }>(async (_req, { userId, params }) => {
  const project = await db.expenseProject.findFirst({ where: { id: params.id, userId }, include: { _count: { select: { expenses: true, notebookEntries: true } } } });
  if (!project) return notFound("Group not found.");
  if (project._count.expenses + project._count.notebookEntries > 0) throw new ValidationError("This group has entries in it. Archive it instead.");
  await db.expenseProject.delete({ where: { id: project.id } });
  return { ok: true };
});
