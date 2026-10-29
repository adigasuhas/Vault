import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireDeveloper } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** The database plan's storage allowance, for the usage bar. Neon's free
 * plan allows 0.5 GB per project; set DB_STORAGE_LIMIT_MB for another plan. */
const LIMIT_MB = Number(process.env.DB_STORAGE_LIMIT_MB) || 512;

/**
 * Storage for the developer console: how big the database is against the
 * plan's allowance, its largest tables, and how many records each user has.
 * Read-only, and counts only: no financial values leave this route.
 */
export async function GET(req: NextRequest) {
  const developer = await requireDeveloper(req);
  if (!developer) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const [size, tables, accounts, ledger, notebook, stocks, funds, schedules] = await Promise.all([
    db.$queryRaw<{ bytes: bigint }[]>`SELECT pg_database_size(current_database()) AS bytes`,
    db.$queryRaw<{ name: string; bytes: bigint }[]>`
      SELECT relname AS name, pg_total_relation_size(relid) AS bytes
      FROM pg_stat_user_tables WHERE schemaname = 'public' ORDER BY pg_total_relation_size(relid) DESC LIMIT 10`,
    db.account.groupBy({ by: ["userId"], _count: { _all: true } }),
    db.ledgerEntry.groupBy({ by: ["userId"], _count: { _all: true } }),
    db.notebookEntry.groupBy({ by: ["userId"], _count: { _all: true } }),
    db.stockHolding.groupBy({ by: ["userId"], _count: { _all: true } }),
    db.mutualFundHolding.groupBy({ by: ["userId"], _count: { _all: true } }),
    db.scheduledCredit.groupBy({ by: ["userId"], _count: { _all: true } }),
  ]);

  const perUser: Record<string, { accounts: number; ledgerEntries: number; notebookEntries: number; holdings: number; schedules: number; records: number }> = {};
  const add = (rows: { userId: string; _count: { _all: number } }[], key: "accounts" | "ledgerEntries" | "notebookEntries" | "holdings" | "schedules") => {
    for (const r of rows) {
      const u = (perUser[r.userId] ??= { accounts: 0, ledgerEntries: 0, notebookEntries: 0, holdings: 0, schedules: 0, records: 0 });
      u[key] += r._count._all;
      u.records += r._count._all;
    }
  };
  add(accounts, "accounts");
  add(ledger, "ledgerEntries");
  add(notebook, "notebookEntries");
  add(stocks, "holdings");
  add(funds, "holdings");
  add(schedules, "schedules");

  // Exact row counts for the listed tables (the statistics' estimates lag).
  // Names come from the catalog and are quoted as identifiers.
  const counted = await Promise.all(
    tables.map(async (t) => {
      const [r] = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${t.name.replace(/"/g, '""')}"`);
      return { name: t.name, bytes: Number(t.bytes), rows: Number(r?.n ?? 0) };
    })
  );
  const bytes = Number(size[0]?.bytes ?? 0);
  return NextResponse.json({
    database: { bytes, limitBytes: LIMIT_MB * 1024 * 1024, usedPct: Math.round((bytes / (LIMIT_MB * 1024 * 1024)) * 1000) / 10 },
    tables: counted,
    perUser,
  });
}
