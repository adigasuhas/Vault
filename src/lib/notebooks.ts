import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { ValidationError } from "@/lib/validate";
import type { Tx } from "@/lib/ledger";

/**
 * Notebooks: independent, named collections of Notebook entries. Every user
 * always has at least one; the first one ("My Notebook" unless renamed) is
 * the default, and where entries go when nothing says otherwise (one-time
 * expenses moved over, an older client that doesn't send a notebook).
 */

export const DEFAULT_NOTEBOOK_NAME = "My Notebook";

type Client = Pick<Tx, "notebook">;

/** The user's first notebook, created ("My Notebook") if they have none. */
export async function defaultNotebookId(userId: string, client: Client = db): Promise<string> {
  const first = await client.notebook.findFirst({ where: { userId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true } });
  if (first) return first.id;
  try {
    return (await client.notebook.create({ data: { userId, name: DEFAULT_NOTEBOOK_NAME }, select: { id: true } })).id;
  } catch (e) {
    // Two requests creating it at once: the other one won, use that.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const again = await client.notebook.findFirst({ where: { userId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true } });
      if (again) return again.id;
    }
    throw e;
  }
}

/** The notebook to use: the one asked for (it must be the user's), or the default. */
export async function resolveNotebookId(userId: string, notebookId: string | null | undefined, client: Client = db): Promise<string> {
  if (!notebookId) return defaultNotebookId(userId, client);
  const nb = await client.notebook.findFirst({ where: { id: notebookId, userId }, select: { id: true } });
  if (!nb) throw new ValidationError("Notebook not found.");
  return nb.id;
}

/** A name not already taken by another of the user's notebooks (case-insensitive). */
export async function assertNotebookNameFree(userId: string, name: string, exceptId?: string) {
  const clash = await db.notebook.findFirst({
    where: { userId, name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
  });
  if (clash) throw new ValidationError(`You already have a notebook called "${clash.name}".`);
}

/**
 * Deletes a notebook. Its entries are never lost silently:
 * - empty: it simply goes;
 * - `moveTo`: every entry moves to that notebook first;
 * - `deleteEntries`: its entries are deleted with it, but only if none was
 *   turned into a loan, expense or receivable (those link to real records;
 *   move them instead).
 * The last notebook can't be deleted.
 */
export async function deleteNotebook(userId: string, id: string, opts: { moveTo?: string | null; deleteEntries?: boolean }) {
  return db.$transaction(async (tx: Tx) => {
    const nb = await tx.notebook.findFirst({ where: { id, userId } });
    if (!nb) throw new ValidationError("Notebook not found.");
    const others = await tx.notebook.count({ where: { userId, id: { not: id } } });
    if (others === 0) throw new ValidationError("This is your only notebook. Create another one before deleting it, or rename it instead.");
    const entries = await tx.notebookEntry.findMany({ where: { notebookId: id }, select: { id: true, status: true } });
    if (entries.length && opts.moveTo) {
      if (opts.moveTo === id) throw new ValidationError("Choose a different notebook to move the entries to.");
      const target = await tx.notebook.findFirst({ where: { id: opts.moveTo, userId } });
      if (!target) throw new ValidationError("The notebook to move them to wasn't found.");
      await tx.notebookEntry.updateMany({ where: { notebookId: id }, data: { notebookId: target.id } });
    } else if (entries.length && opts.deleteEntries) {
      const converted = entries.filter((e) => e.status !== "OPEN").length;
      if (converted) {
        throw new ValidationError(
          `${converted} ${converted === 1 ? "entry was" : "entries were"} turned into a loan, expense or receivable, so ${converted === 1 ? "it's" : "they're"} kept. Move the entries to another notebook instead.`
        );
      }
      await tx.notebookEntry.deleteMany({ where: { notebookId: id } });
    } else if (entries.length) {
      throw new ValidationError(`${nb.name} has ${entries.length} ${entries.length === 1 ? "entry" : "entries"}. Move ${entries.length === 1 ? "it" : "them"} to another notebook or delete ${entries.length === 1 ? "it" : "them"} too.`);
    }
    await tx.notebook.delete({ where: { id } });
    return { deleted: true, moved: opts.moveTo && entries.length ? entries.length : 0, deletedEntries: !opts.moveTo && opts.deleteEntries ? entries.length : 0 };
  });
}
