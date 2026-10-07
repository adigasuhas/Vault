import { db } from "@/lib/db";
import { authed } from "@/lib/api";
import { parseJson, ValidationError } from "@/lib/validate";
import { expenseProjectSchema } from "@/lib/schemas";
import { createFxConverter } from "@/lib/fx";

export const dynamic = "force-dynamic";

/** Named groups of Notebook entries ("Liverpool move"), each with what it
 * added up to: per currency, plus a total in the user's main currency. */
export const GET = authed(async (req, { userId }) => {
  const includeArchived = req.nextUrl.searchParams.get("includeArchived") === "1";
  const [projects, sums, user] = await Promise.all([
    db.expenseProject.findMany({ where: { userId, ...(includeArchived ? {} : { archivedAt: null }) }, orderBy: { createdAt: "desc" } }),
    db.notebookEntry.groupBy({
      by: ["projectId", "currency"],
      where: { userId, projectId: { not: null } },
      _sum: { amount: true },
      _count: { _all: true },
      _max: { date: true },
    }),
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { baseCurrency: true } }),
  ]);
  const fx = await createFxConverter(userId, user.baseCurrency);
  return {
    currency: user.baseCurrency,
    projects: projects.map((p) => {
      const rows = sums.filter((s) => s.projectId === p.id);
      const byCurrency = rows.map((r) => ({ currency: r.currency, amount: Number(r._sum.amount ?? 0) }));
      let total: number | null = 0;
      for (const r of byCurrency) {
        const v = fx.convertTo(r.amount, r.currency, user.baseCurrency);
        total = v == null || total == null ? null : total + v;
      }
      const last = rows.reduce<Date | null>((m, r) => (r._max.date && (!m || r._max.date > m) ? r._max.date : m), null);
      return { ...p, count: rows.reduce((n, r) => n + r._count._all, 0), byCurrency, total, lastDate: last };
    }),
  };
});

export const POST = authed(async (req, { userId }) => {
  const input = await parseJson(req, expenseProjectSchema);
  const clash = await db.expenseProject.findFirst({ where: { userId, name: { equals: input.name, mode: "insensitive" } } });
  if (clash) throw new ValidationError(`You already have a group called "${clash.name}".`);
  const project = await db.expenseProject.create({ data: { userId, name: input.name, notes: input.notes ?? null } });
  return Response.json({ project }, { status: 201 });
});
