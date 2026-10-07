import { db } from "@/lib/db";
import { authed } from "@/lib/api";
import { parseJson, ValidationError } from "@/lib/validate";
import { notebookEntrySchema } from "@/lib/schemas";
import { moveOneTimeExpensesToNotebook } from "@/lib/notebook";
import { dateOnly } from "@/lib/dates";

export const dynamic = "force-dynamic";

/** Every Notebook entry, newest first. */
export const GET = authed(async (_req, { userId }) => {
  await moveOneTimeExpensesToNotebook(userId);
  const [entries, user] = await Promise.all([
    db.notebookEntry.findMany({
      where: { userId },
      include: { project: { select: { id: true, name: true } } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    }),
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { baseCurrency: true } }),
  ]);
  return { entries, currency: user.baseCurrency };
});

export const POST = authed(async (req, { userId }) => {
  const input = await parseJson(req, notebookEntrySchema);
  if (input.projectId && !(await db.expenseProject.findFirst({ where: { id: input.projectId, userId } }))) {
    throw new ValidationError("Group not found.");
  }
  const entry = await db.notebookEntry.create({
    data: {
      userId,
      title: input.title,
      amount: input.amount,
      currency: input.currency,
      date: dateOnly(input.date),
      paidBy: input.paidBy,
      person: input.person ?? null,
      notes: input.notes ?? null,
      projectId: input.projectId ?? null,
    },
  });
  return Response.json({ entry }, { status: 201 });
});
