import { db } from "@/lib/db";
import { authed } from "@/lib/api";
import { parseJson, ValidationError } from "@/lib/validate";
import { notebookEntrySchema } from "@/lib/schemas";
import { moveOneTimeExpensesToNotebook } from "@/lib/notebook";
import { dateOnly } from "@/lib/dates";
import { possibleDuplicates, sameThingKey } from "@/lib/notebook-checks";

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
  // Entries that look like the same thing written twice, for the user to review.
  return { entries, currency: user.baseCurrency, possibleDuplicates: possibleDuplicates(entries) };
});

export const POST = authed(async (req, { userId }) => {
  const input = await parseJson(req, notebookEntrySchema);
  if (input.projectId && !(await db.expenseProject.findFirst({ where: { id: input.projectId, userId } }))) {
    throw new ValidationError("Group not found.");
  }
  // The same entry sent twice in quick succession (a double submit, a retry)
  // is saved once: the second request gets the first one back.
  const recent = await db.notebookEntry.findMany({
    where: { userId, paidBy: input.paidBy, createdAt: { gte: new Date(Date.now() - 30_000) } },
  });
  const key = sameThingKey({ ...input, date: dateOnly(input.date), id: "", status: "OPEN" });
  const twin = recent.find((r: (typeof recent)[number]) => sameThingKey(r) === key && (r.person ?? null) === (input.person ?? null));
  if (twin) return Response.json({ entry: twin, duplicate: true }, { status: 200 });
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
