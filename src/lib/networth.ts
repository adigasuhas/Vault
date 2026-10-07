import { db } from "@/lib/db";
import { createFxConverter, type FxConverter } from "@/lib/fx";
import { computePortfolioValue } from "@/lib/portfolio";
import { fdCurrentValue } from "@/lib/investments";
import { signedAmount } from "@/lib/ledger";
import { loanLiabilities } from "@/lib/loan-balance";
import type { SoldLot } from "@/lib/investment-sales";

/**
 * Net-worth history (finding F9).
 *
 * The old implementation applied *today's* investment value to every past
 * month. This instead:
 *   1. records a real snapshot once a day (`recordNetWorthSnapshot`), and
 *   2. for any month with no snapshot yet, reconstructs the figure from the
 *      ledger — cash is exact (opening balance + signed entries up to that
 *      date), investments are valued at cost basis for the holdings that
 *      existed then (we have no historical price feed). Those points are
 *      flagged `estimated: true`.
 */

/** Computes and upserts today's snapshot for one user. Best-effort caller. */
export async function recordNetWorthSnapshot(userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { baseCurrency: true } });
  if (!user) return;
  const fx = await createFxConverter(userId, user.baseCurrency);

  // Archived accounts still hold money; only closed ones (zeroed on close) drop out.
  const accounts = await db.account.findMany({ where: { userId, status: { not: "CLOSED" } } });
  const cash = accounts.reduce((s, a) => s + fx.convert(Number(a.currentBalance), a.currency), 0);
  const [portfolio, loans] = await Promise.all([
    computePortfolioValue(userId, user.baseCurrency, fx),
    loanLiabilities(userId, fx),
  ]);
  const netWorth = cash + portfolio.total - loans.total;

  const today = new Date();
  const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  await db.netWorthSnapshot.upsert({
    where: { userId_date: { userId, date } },
    update: { cash, investments: portfolio.total, netWorth, baseCurrency: user.baseCurrency },
    create: {
      userId,
      date,
      cash,
      investments: portfolio.total,
      netWorth,
      baseCurrency: user.baseCurrency,
    },
  });
}

/** Records today's snapshot only if there isn't one yet. Cheap enough to call
 * on a dashboard/analytics load so history keeps building even where the daily
 * cron never fires (local dev). Fire-and-forget. */
export async function ensureTodaySnapshot(userId: string) {
  const today = new Date();
  const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const existing = await db.netWorthSnapshot.findUnique({
    where: { userId_date: { userId, date } },
    select: { id: true },
  });
  if (!existing) await recordNetWorthSnapshot(userId);
}

export async function recordAllNetWorthSnapshots() {
  const users = await db.user.findMany({ where: { status: "ACTIVE", deletedAt: null }, select: { id: true } });
  let ok = 0;
  for (const u of users) {
    try {
      await recordNetWorthSnapshot(u.id);
      ok++;
    } catch (e) {
      console.error(`net-worth snapshot failed for ${u.id}:`, e);
    }
  }
  return { users: users.length, recorded: ok };
}

export interface NetWorthPoint {
  month: string; // YYYY-MM
  netWorth: number;
  cash: number;
  investments: number;
  estimated: boolean;
}

/** Cost-basis value of every holding that existed on or before `asOf`. */
async function reconstructInvestmentsAt(userId: string, asOf: Date, fx: FxConverter): Promise<number> {
  const [stocks, funds, deposits, other, sales] = await Promise.all([
    db.stockHolding.findMany({ where: { userId }, include: { lots: true } }),
    db.mutualFundHolding.findMany({ where: { userId }, include: { lots: true } }),
    db.fixedDeposit.findMany({ where: { userId } }),
    db.otherAsset.findMany({ where: { userId } }),
    db.investmentSale.findMany({ where: { userId, reversedAt: null } }),
  ]);

  let total = 0;
  for (const s of stocks) {
    const held = s.lots.filter((l) => l.purchaseDate <= asOf);
    const value = held.reduce((sum, l) => sum + Number(l.quantity) * Number(l.price), 0);
    if (value > 0) total += fx.convert(value, s.currency);
  }
  for (const f of funds) {
    // Count only the purchases made by then (falls back to the aggregate).
    const value = f.lots.length
      ? f.lots.filter((l) => l.purchaseDate <= asOf).reduce((sum, l) => sum + Number(l.units) * Number(l.nav), 0)
      : f.purchaseDate <= asOf ? Number(f.units) * Number(f.avgNav) : 0;
    if (value > 0) total += fx.convert(value, f.currency);
  }
  for (const d of deposits) {
    if (d.startDate <= asOf) {
      const cap = asOf < d.maturityDate ? asOf : d.maturityDate;
      total += fx.convert(fdCurrentValue(Number(d.principal), Number(d.interestRate), d.startDate, cap), d.currency);
    }
  }
  for (const a of other) {
    if (a.purchaseDate <= asOf) total += fx.convert(Number(a.purchasePrice), a.currency);
  }
  // Sold later: still held on `asOf`, and its proceeds aren't in cash yet.
  for (const s of sales) {
    if (s.soldOn <= asOf) continue;
    const lots = s.lots as unknown as SoldLot[];
    if (s.kind === "FIXED_DEPOSIT") {
      const snap = s.snapshot as { interestRate?: string; maturityDate?: string };
      if (s.firstBoughtOn <= asOf && snap.maturityDate) {
        const maturity = new Date(snap.maturityDate);
        total += fx.convert(fdCurrentValue(Number(s.costBasis), Number(snap.interestRate ?? 0), s.firstBoughtOn, asOf < maturity ? asOf : maturity), s.currency);
      }
      continue;
    }
    const cost = lots.filter((l) => new Date(l.purchaseDate) <= asOf).reduce((sum, l) => sum + l.cost, 0);
    if (cost > 0) total += fx.convert(cost, s.currency);
  }
  return total;
}

export async function netWorthHistory(userId: string, months: string[]): Promise<NetWorthPoint[]> {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { baseCurrency: true } });
  const baseCurrency = user.baseCurrency;
  const fx = await createFxConverter(userId, baseCurrency);

  const rangeStart = new Date(`${months[0]}-01T00:00:00.000Z`);

  const [snapshots, ledger] = await Promise.all([
    db.netWorthSnapshot.findMany({
      where: { userId, date: { gte: rangeStart } },
      orderBy: { date: "asc" },
    }),
    db.ledgerEntry.findMany({
      // Purchases logged without an account move no balance.
      where: { userId, accountId: { not: null } },
      select: { type: true, amount: true, currency: true, date: true },
      orderBy: { date: "asc" },
    }),
  ]);

  // Latest snapshot per month.
  const snapByMonth = new Map<string, (typeof snapshots)[number]>();
  for (const s of snapshots) {
    const m = s.date.toISOString().slice(0, 7);
    snapByMonth.set(m, s); // ordered asc → last write wins = latest in month
  }


  const out: NetWorthPoint[] = [];
  for (const month of months) {
    const snap = snapByMonth.get(month);
    if (snap) {
      // Derived from the snapshot's parts rather than its stored netWorth:
      // snapshots taken before loans counted as debt overstated it.
      const loans = await loanLiabilities(userId, fx, new Date(snap.date.getTime() + 86_399_999));
      out.push({
        month,
        netWorth: Number(snap.cash) + Number(snap.investments) - loans.total,
        cash: Number(snap.cash),
        investments: Number(snap.investments),
        estimated: false,
      });
      continue;
    }
    // Reconstruct at month-end (or "now" for the current month).
    const monthEnd = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0, 23, 59, 59));
    const asOf = monthEnd > new Date() ? new Date() : monthEnd;

    // Opening balances are ledger entries, so cash at a date is simply the
    // sum of every signed entry up to it (closed accounts net to zero).
    let cash = 0;
    for (const e of ledger) {
      if (e.date > asOf) break;
      cash += fx.convert(signedAmount(e.type, Number(e.amount)), e.currency);
    }
    const [investments, loans] = await Promise.all([reconstructInvestmentsAt(userId, asOf, fx), loanLiabilities(userId, fx, asOf)]);
    out.push({ month, netWorth: cash + investments - loans.total, cash, investments, estimated: true });
  }
  return out;
}
