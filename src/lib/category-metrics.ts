import { fdCurrentValue } from "@/lib/investments";

/**
 * Category figures, worked out from the same holdings and valuations the rest
 * of the Investments page uses — a category only picks which holdings to add
 * up. An investment in two categories counts fully in both, so category
 * totals can add up to more than the portfolio; the portfolio total is
 * always computed from the holdings themselves, never from categories.
 */

export type InvestmentKind = "STOCK" | "MUTUAL_FUND" | "FIXED_DEPOSIT" | "OTHER";
export const linkKey = (kind: InvestmentKind, holdingId: string) => `${kind}:${holdingId}`;

export interface CategoryLite {
  id: string;
  name: string;
  color: number;
  links: { kind: InvestmentKind; holdingId: string }[];
}

/** A current holding, in its own currency. */
export interface Position {
  kind: InvestmentKind;
  id: string;
  name: string;
  currency: string;
  invested: number;
  value: number;
  /** Purchases with a quantity (stocks, funds), for valuing at past prices. */
  lots?: { qty: number; cost: number; date: string }[];
  deposit?: { principal: number; rate: number; start: string; maturity: string };
  /** Valued by hand (other assets): when it was last valued. */
  valuedOn?: string | null;
}

export interface SaleLite {
  kind: InvestmentKind;
  holdingId: string;
  currency: string;
  realizedPnl: number;
  reversedAt: string | null;
}

export type ToBase = (amount: number, currency: string) => number;

export interface CategoryRow {
  id: string;
  name: string;
  color: number;
  count: number;
  invested: number;
  value: number;
  pnl: number;
  /** Return on what's held now; null with nothing invested. */
  pct: number | null;
  /** Share of the whole portfolio's current value. */
  allocation: number;
  realized: number;
  soldCount: number;
  /** Holdings valued by hand, and the oldest of those valuations. */
  manual: number;
  oldestValuation: string | null;
  positions: Position[];
}

export function membersOf(cat: Pick<CategoryLite, "links">, positions: Position[]) {
  const keys = new Set(cat.links.map((l) => linkKey(l.kind, l.holdingId)));
  return positions.filter((p) => keys.has(linkKey(p.kind, p.id)));
}

export function categoryRows(categories: CategoryLite[], positions: Position[], sales: SaleLite[], toBase: ToBase, portfolioValue: number): CategoryRow[] {
  return categories.map((c) => {
    const members = membersOf(c, positions);
    const keys = new Set(c.links.map((l) => linkKey(l.kind, l.holdingId)));
    const invested = members.reduce((t, p) => t + toBase(p.invested, p.currency), 0);
    const value = members.reduce((t, p) => t + toBase(p.value, p.currency), 0);
    // A sold holding keeps its categories, so its realised result stays here.
    const sold = sales.filter((s) => !s.reversedAt && keys.has(linkKey(s.kind, s.holdingId)));
    const manual = members.filter((p) => p.valuedOn !== undefined);
    const oldest = manual.map((p) => p.valuedOn).filter((d): d is string => !!d).sort()[0] ?? null;
    return {
      id: c.id,
      name: c.name,
      color: c.color,
      count: members.length,
      invested,
      value,
      pnl: value - invested,
      pct: invested > 0 ? ((value - invested) / invested) * 100 : null,
      allocation: portfolioValue > 0 ? (value / portfolioValue) * 100 : 0,
      realized: sold.reduce((t, s) => t + toBase(s.realizedPnl, s.currency), 0),
      soldCount: sold.length,
      manual: manual.length,
      oldestValuation: oldest,
      positions: members,
    };
  });
}

/** Holdings that are in no category, so the figures can be reconciled. */
export function uncategorised(categories: CategoryLite[], positions: Position[]) {
  const keys = new Set(categories.flatMap((c) => c.links.map((l) => linkKey(l.kind, l.holdingId))));
  return positions.filter((p) => !keys.has(linkKey(p.kind, p.id)));
}

export interface GrowthPoint { d: string; value: number; invested: number }
export interface Growth {
  points: GrowthPoint[];
  /** Holdings in the chart. */
  charted: Position[];
  /** Holdings left out, and why: no history is ever made up. */
  skipped: { position: Position; reason: string }[];
  /** First day real history exists for everything charted. */
  historyFrom: string | null;
}

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/**
 * Value over time of the holdings a category has now, from real prices:
 * stocks and funds at each day's close (from the day each purchase was
 * made), deposits by their interest accrual. Holdings valued by hand have no
 * history, so they're left out and listed. Amounts convert at today's rates.
 */
export function categoryGrowth(
  positions: Position[],
  series: Record<string, { d: string; v: number }[]>,
  toBase: ToBase,
  range: { from?: string; to?: string } = {},
  today: string = iso(Date.now())
): Growth {
  const charted: Position[] = [];
  const skipped: Growth["skipped"] = [];
  const priced: { p: Position; s: { d: string; v: number }[] }[] = [];
  for (const p of positions) {
    if (p.kind === "FIXED_DEPOSIT" && p.deposit) charted.push(p);
    else if ((p.kind === "STOCK" || p.kind === "MUTUAL_FUND") && p.lots?.length) {
      const s = (series[p.id] ?? []).filter((x) => Number.isFinite(x.v) && x.v > 0).sort((a, b) => a.d.localeCompare(b.d));
      if (s.length < 2) skipped.push({ position: p, reason: p.kind === "MUTUAL_FUND" ? "no NAV history (add its scheme code)" : "no price history" });
      else {
        charted.push(p);
        priced.push({ p, s });
      }
    } else if (p.kind === "OTHER") skipped.push({ position: p, reason: "valued by hand" });
    else skipped.push({ position: p, reason: "no dated purchases" });
  }
  if (!charted.length) return { points: [], charted, skipped, historyFrom: null };

  // History starts where every priced holding has a price.
  const historyFrom = priced.length ? priced.map((x) => x.s[0].d).sort().at(-1)! : null;
  const earliestBuy = charted
    .flatMap((p) => (p.lots ?? []).map((l) => l.date.slice(0, 10)).concat(p.deposit ? [p.deposit.start.slice(0, 10)] : []))
    .sort()[0];
  let from = [range.from, historyFrom, earliestBuy].filter((d): d is string => !!d).sort().at(-1)!;
  const to = range.to && range.to < today ? range.to : today;
  if (from > to) from = to;

  let days: string[];
  if (priced.length) {
    days = [...new Set(priced.flatMap((x) => x.s.map((pt) => pt.d)))].filter((d) => d >= from && d <= to).sort();
    if (!days.length || days[0] > from) days.unshift(from);
  } else {
    days = [];
    for (let t = Date.parse(from); t <= Date.parse(to); t += 7 * DAY) days.push(iso(t));
  }
  if (days.at(-1) !== to && to <= today) days.push(to);

  // Last close on or before a day (prices carry over weekends and holidays).
  const cursor = new Map(priced.map((x) => [x.p.id, 0]));
  const priceOn = (id: string, s: { d: string; v: number }[], d: string) => {
    let i = cursor.get(id)!;
    while (i + 1 < s.length && s[i + 1].d <= d) i++;
    cursor.set(id, i);
    return s[i].d <= d ? s[i].v : s[0].v;
  };

  const points = days.map((d) => {
    let value = 0;
    let invested = 0;
    for (const { p, s } of priced) {
      const price = priceOn(p.id, s, d);
      for (const l of p.lots!) {
        if (l.date.slice(0, 10) > d) continue;
        value += toBase(l.qty * price, p.currency);
        invested += toBase(l.cost, p.currency);
      }
    }
    for (const p of charted) {
      if (!p.deposit || p.deposit.start.slice(0, 10) > d) continue;
      value += toBase(fdCurrentValue(p.deposit.principal, p.deposit.rate, p.deposit.start, p.deposit.maturity, `${d}T12:00:00Z`), p.currency);
      invested += toBase(p.deposit.principal, p.currency);
    }
    return { d, value, invested };
  });
  return { points, charted, skipped, historyFrom };
}
