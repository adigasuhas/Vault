import { db } from "@/lib/db";
import { authed } from "@/lib/api";
import { parseJson } from "@/lib/validate";
import { notebookSchema } from "@/lib/schemas";
import { assertNotebookNameFree, defaultNotebookId } from "@/lib/notebooks";

export const dynamic = "force-dynamic";

/** The user's notebooks, oldest first, each with how many entries it holds.
 * There is always at least one ("My Notebook" for a new user). */
export const GET = authed(async (_req, { userId }) => {
  const defaultId = await defaultNotebookId(userId);
  const [notebooks, counts] = await Promise.all([
    db.notebook.findMany({ where: { userId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    db.notebookEntry.groupBy({ by: ["notebookId", "status"], where: { userId }, _count: { _all: true } }),
  ]);
  const count = (id: string, status?: "OPEN" | "CONVERTED") =>
    counts.filter((c) => c.notebookId === id && (!status || c.status === status)).reduce((n, c) => n + c._count._all, 0);
  return {
    defaultId,
    notebooks: notebooks.map((n) => ({ id: n.id, name: n.name, createdAt: n.createdAt, entries: count(n.id), open: count(n.id, "OPEN"), converted: count(n.id, "CONVERTED") })),
  };
});

export const POST = authed(async (req, { userId }) => {
  const { name } = await parseJson(req, notebookSchema);
  await assertNotebookNameFree(userId, name);
  const notebook = await db.notebook.create({ data: { userId, name } });
  return Response.json({ notebook }, { status: 201 });
});
