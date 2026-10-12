import { db } from "@/lib/db";
import { createFxConverter, type FxConverter } from "@/lib/fx";
import { fdCurrentValue } from "@/lib/investments";
import { linkKey, partOf, type InvestmentKind, type Position } from "@/lib/category-metrics";
import { priceHistory, type PricePoint } from "@/lib/price-history";
import { priceStatus } from "@/lib/price-freshness";
import { ValidationError } from "@/lib/validate";
import type { Report, ReportColumn } from "@/lib/reports";

/**
 * Investment reports, as plain Report objects (see lib/reports) so the CSV
 * and PDF exports render exactly the same rows.
 *
 * Figures come from the same records and valuation rules as the Investments
 * page: a holding's value is quantity × its latest price (at cost when there
 * is no price yet, and said so), deposits accrue simple interest, other
 * assets use their last manual valuation. Purchases are rebuilt from the
 * remaining part of each purchase plus what sales took from it, so a partly
 * sold purchase shows what was actually bought. Undone sales are not trades.
 *
 * Category filters follow the category model: a stock can be in a category
 * as a whole or purchase by purchase (clients). Filtering keeps only the
 * shares in the chosen categories, and a holding in several chosen
 * categories still counts once.
 */

export const INVESTMENT_REPORTS = ["portfolio", "trades", "transactions", "categories", "performance"] as const;
export type InvestmentReportType = (typeof INVESTMENT_REPORTS)[number];
export const ASSET_TYPES: InvestmentKind[] = ["STOCK", "MUTUAL_FUND", "FIXED_DEPOSIT", "OTHER"];
export const UNCATEGORISED = "__none__";

export interface InvestmentReportParams {
  type: InvestmentReportType;
  /** YYYY-MM-DD; not used by the portfolio snapshot. */
  from?: string;
  to?: string;
  assetTypes?: InvestmentKind[];
  /** Category ids, and/or UNCATEGORISED. Empty: everything. */
  categoryIds?: string[];
}

const KIND_LABEL: Record<InvestmentKind, string> = { STOCK: "Stock", MUTUAL_FUND: "Mutual fund", FIXED_DEPOSIT: "Fixed deposit", OTHER: "Other asset" };
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const day = (d: Date | string) => (typeof d === "string" ? d : d.toISOString()).slice(0, 10);
const r2 = (n: number) => Math.round(n * 100) / 100;

interface SoldLotJson { lotId: string | null; purchaseDate: string; quantity: number | null; price: number | null; cost: number }
interface ReinvestmentJson { amount: number; into: string; date: string; ref?: string }

// ------------------------------------------------------------------ loading

async function load(userId: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { baseCurrency: true, name: true, email: true } });
  const fx = await createFxConverter(userId, user.baseCurrency);
  const [stocks, funds, deposits, assets, sales, categories, ledger] = await Promise.all([
    db.stockHolding.findMany({ where: { userId }, include: { lots: true }, orderBy: { ticker: "asc" } }),
    db.mutualFundHolding.findMany({ where: { userId }, include: { lots: true }, orderBy: { fundName: "asc" } }),
    db.fixedDeposit.findMany({ where: { userId }, orderBy: { startDate: "asc" } }),
    db.otherAsset.findMany({ where: { userId }, orderBy: { name: "asc" } }),
    db.investmentSale.findMany({ where: { userId }, include: { account: { select: { name: true } } }, orderBy: { soldOn: "asc" } }),
    db.investmentCategory.findMany({ where: { userId }, include: { links: { select: { kind: true, holdingId: true } }, lotLinks: { select: { lotId: true } } }, orderBy: { name: "asc" } }),
    db.ledgerEntry.findMany({
      where: { userId, OR: [{ type: { in: ["INVESTMENT_PURCHASE", "INVESTMENT_SALE"] } }, { type: "REVERSAL", reversalOf: { type: { in: ["INVESTMENT_PURCHASE", "INVESTMENT_SALE"] } } }] },
      include: { account: { select: { name: true } }, reversalOf: { select: { type: true, investmentRef: true, investmentSaleId: true } } },
      orderBy: { date: "asc" },
    }),
  ]);
  return { user, base: user.baseCurrency, fx, stocks, funds, deposits, assets, sales, categories, ledger };
}
type Data = Awaited<ReturnType<typeof load>>;

/** Which holdings and purchases the category filter keeps. */
function membership(d: Data, categoryIds: string[]) {
  const holdingCats = new Map<string, string[]>();
  const lotCats = new Map<string, string[]>();
  for (const c of d.categories) {
    for (const l of c.links) holdingCats.set(linkKey(l.kind, l.holdingId), [...(holdingCats.get(linkKey(l.kind, l.holdingId)) ?? []), c.id]);
    for (const l of c.lotLinks) lotCats.set(l.lotId, [...(lotCats.get(l.lotId) ?? []), c.id]);
  }
  const name = new Map(d.categories.map((c) => [c.id, c.name]));
  const selected = new Set(categoryIds);
  const none = selected.has(UNCATEGORISED);
  const active = selected.size > 0;
  /** Whether a holding (or one of its purchases) is in the selection. */
  const includes = (kind: InvestmentKind, holdingId: string, lotId?: string | null) => {
    if (!active) return true;
    const hc = holdingCats.get(linkKey(kind, holdingId)) ?? [];
    const lc = lotId ? lotCats.get(lotId) ?? [] : [];
    if (hc.some((c) => selected.has(c)) || lc.some((c) => selected.has(c))) return true;
    return none && !hc.length && !lc.length;
  };
  const names = (kind: InvestmentKind, holdingId: string, lotIds?: (string | null)[]) => {
    const ids = new Set([...(holdingCats.get(linkKey(kind, holdingId)) ?? []), ...(lotIds ?? []).flatMap((l) => (l ? lotCats.get(l) ?? [] : []))]);
    return [...ids].map((i) => name.get(i)).filter(Boolean).sort().join("; ");
  };
  return { includes, names, active };
}

interface Holding extends Position {
  ticker: string;
  exchange: string | null;
  quantity: number | null;
  price: number | null;
  priceAt: string | null;
  status: "Live" | "Stale" | "No price, valued at cost" | "Interest accrual" | "Manual valuation";
}

/** Current holdings, valued as on the Investments page, narrowed to the
 * asset types and categories chosen. Each holding appears once. */
function holdings(d: Data, kinds: Set<InvestmentKind>, m: ReturnType<typeof membership>): Holding[] {
  const out: Holding[] = [];
  if (kinds.has("STOCK"))
    for (const h of d.stocks) {
      const st = priceStatus(h.lastPrice?.toString(), h.lastPriceAt);
      const price = h.lastPrice != null ? Number(h.lastPrice) : null;
      const qty = Number(h.quantity);
      const full: Position = {
        kind: "STOCK", id: h.id, name: h.ticker, currency: h.currency,
        invested: Number(h.avgBuyPrice) * qty,
        value: (price ?? Number(h.avgBuyPrice)) * qty,
        lots: h.lots.map((l) => ({ id: l.id, qty: Number(l.quantity), cost: Number(l.quantity) * Number(l.price), date: day(l.purchaseDate) })),
      };
      const kept = m.active ? partOf(full, (lotId) => m.includes("STOCK", h.id, lotId)) : full;
      if (!kept) continue;
      out.push({ ...kept, ticker: h.ticker, exchange: h.exchange, quantity: kept.part?.qty ?? qty, price, priceAt: h.lastPriceAt?.toISOString() ?? null, status: st === "live" ? "Live" : st === "stale" ? "Stale" : "No price, valued at cost" });
    }
  if (kinds.has("MUTUAL_FUND"))
    for (const f of d.funds) {
      if (!m.includes("MUTUAL_FUND", f.id)) continue;
      const st = priceStatus(f.lastNav?.toString(), f.lastNavAt);
      const units = Number(f.units);
      out.push({
        kind: "MUTUAL_FUND", id: f.id, name: f.fundName, currency: f.currency, invested: Number(f.avgNav) * units, value: Number(f.lastNav ?? f.avgNav) * units,
        lots: f.lots.map((l) => ({ id: l.id, qty: Number(l.units), cost: Number(l.units) * Number(l.nav), date: day(l.purchaseDate) })),
        ticker: f.schemeCode ?? "", exchange: null, quantity: units, price: f.lastNav != null ? Number(f.lastNav) : null, priceAt: f.lastNavAt?.toISOString() ?? null,
        status: st === "live" ? "Live" : st === "stale" ? "Stale" : "No price, valued at cost",
      });
    }
  if (kinds.has("FIXED_DEPOSIT"))
    for (const fd of d.deposits) {
      if (!m.includes("FIXED_DEPOSIT", fd.id)) continue;
      out.push({
        kind: "FIXED_DEPOSIT", id: fd.id, name: `${fd.bank} deposit`, currency: fd.currency, invested: Number(fd.principal),
        value: fdCurrentValue(Number(fd.principal), Number(fd.interestRate), fd.startDate, fd.maturityDate),
        deposit: { principal: Number(fd.principal), rate: Number(fd.interestRate), start: day(fd.startDate), maturity: day(fd.maturityDate) },
        ticker: "", exchange: null, quantity: null, price: null, priceAt: null, status: "Interest accrual",
      });
    }
  if (kinds.has("OTHER"))
    for (const a of d.assets) {
      if (!m.includes("OTHER", a.id)) continue;
      out.push({
        kind: "OTHER", id: a.id, name: a.name, currency: a.currency, invested: Number(a.purchasePrice), value: Number(a.currentValue), valuedOn: day(a.updatedAt),
        ticker: a.assetType, exchange: null, quantity: a.quantity != null ? Number(a.quantity) : null, price: null, priceAt: a.updatedAt.toISOString(), status: "Manual valuation",
      });
    }
  return out;
}

/** Converts to the report currency at today's rates; null when no rate exists
 * (never silently 1:1). */
function toBase(fx: FxConverter, base: string) {
  return (n: number | null, c: string) => (n == null ? null : c === base ? n : fx.convertTo(n, c, base));
}

// ------------------------------------------------------------------- trades

interface Trade {
  date: string;
  action: string;
  kind: InvestmentKind;
  holdingId: string;
  lotIds: (string | null)[];
  name: string;
  ticker: string;
  quantity: number | null;
  price: number | null;
  gross: number;
  charges: number | null;
  net: number;
  cost: number | null;
  realised: number | null;
  currency: string;
  account: string;
  saleId?: string;
  undoneOn?: string | null;
}

/** Every purchase and sale actually made, rebuilt from the records. With a
 * category filter, a sale spanning purchases is split by purchase. */
function trades(d: Data, kinds: Set<InvestmentKind>, m: ReturnType<typeof membership>, includeUndone = false): Trade[] {
  const out: Trade[] = [];
  const live = d.sales.filter((s) => !s.reversedAt);
  // Quantity each purchase lost to sales (that weren't undone).
  const soldFrom = new Map<string, { qty: number; date: string; price: number | null; holdingId: string; name: string; kind: InvestmentKind; currency: string }>();
  for (const s of live) {
    if (s.kind !== "STOCK" && s.kind !== "MUTUAL_FUND") continue;
    for (const l of s.lots as unknown as SoldLotJson[]) {
      if (!l.lotId) continue;
      const prev = soldFrom.get(l.lotId);
      soldFrom.set(l.lotId, { qty: (prev?.qty ?? 0) + Number(l.quantity ?? 0), date: day(l.purchaseDate), price: l.price, holdingId: s.holdingId, name: s.name, kind: s.kind, currency: s.currency });
    }
  }
  const seenLots = new Set<string>();
  const buy = (kind: InvestmentKind, holdingId: string, lotId: string, name: string, ticker: string, date: string, qty: number, price: number, currency: string) => {
    seenLots.add(lotId);
    if (!kinds.has(kind) || !m.includes(kind, holdingId, lotId)) return;
    out.push({ date, action: kind === "MUTUAL_FUND" ? "Buy units" : "Buy", kind, holdingId, lotIds: [lotId], name, ticker, quantity: qty, price, gross: qty * price, charges: null, net: qty * price, cost: null, realised: null, currency, account: "" });
  };
  for (const h of d.stocks) for (const l of h.lots) buy("STOCK", h.id, l.id, h.ticker, h.ticker, day(l.purchaseDate), Number(l.quantity) + (soldFrom.get(l.id)?.qty ?? 0), Number(l.price), h.currency);
  for (const f of d.funds) for (const l of f.lots) buy("MUTUAL_FUND", f.id, l.id, f.fundName, f.schemeCode ?? "", day(l.purchaseDate), Number(l.units) + (soldFrom.get(l.id)?.qty ?? 0), Number(l.nav), f.currency);
  // Purchases a sale used up entirely: only the sale remembers them.
  for (const [lotId, s] of soldFrom) if (!seenLots.has(lotId) && s.price != null) buy(s.kind, s.holdingId, lotId, s.name, s.kind === "STOCK" ? s.name : "", s.date, s.qty, s.price, s.currency);

  const opened = (kind: InvestmentKind, holdingId: string, name: string, ticker: string, date: string, amount: number, currency: string, action: string, quantity: number | null = null) => {
    if (!kinds.has(kind) || !m.includes(kind, holdingId)) return;
    out.push({ date, action, kind, holdingId, lotIds: [null], name, ticker, quantity, price: null, gross: amount, charges: null, net: amount, cost: null, realised: null, currency, account: "" });
  };
  for (const fd of d.deposits) opened("FIXED_DEPOSIT", fd.id, `${fd.bank} deposit`, "", day(fd.startDate), Number(fd.principal), fd.currency, "Deposit opened");
  for (const a of d.assets) opened("OTHER", a.id, a.name, a.assetType, day(a.purchaseDate), Number(a.purchasePrice), a.currency, "Bought", a.quantity != null ? Number(a.quantity) : null);
  // Closed deposits and sold assets no longer exist as rows: their sale keeps what they were.
  for (const s of live) {
    const snap = s.snapshot as Record<string, string | null>;
    if (s.kind === "FIXED_DEPOSIT" && !d.deposits.some((x) => x.id === s.holdingId)) opened("FIXED_DEPOSIT", s.holdingId, `${s.name} deposit`, "", day(String(snap.startDate)), Number(snap.principal), s.currency, "Deposit opened");
    if (s.kind === "OTHER" && !d.assets.some((x) => x.id === s.holdingId)) opened("OTHER", s.holdingId, s.name, String(snap.assetType ?? ""), day(String(snap.purchaseDate)), Number(snap.purchasePrice), s.currency, "Bought", snap.quantity != null ? Number(snap.quantity) : null);
  }

  for (const s of includeUndone ? d.sales : live) {
    if (!kinds.has(s.kind)) continue;
    const action = s.kind === "FIXED_DEPOSIT" ? "Deposit closed" : s.kind === "MUTUAL_FUND" ? "Redeem units" : "Sell";
    const account = s.account?.name ?? "Kept to reinvest";
    const lots = s.lots as unknown as SoldLotJson[];
    const qty = s.quantity != null ? Number(s.quantity) : null;
    const base = { date: day(s.soldOn), action, kind: s.kind, holdingId: s.holdingId, name: s.name, ticker: s.kind === "STOCK" ? s.name : String((s.snapshot as Record<string, unknown>).schemeCode ?? s.detail ?? ""), price: s.price != null ? Number(s.price) : null, currency: s.currency, account, saleId: s.id, undoneOn: s.reversedAt ? day(s.reversedAt) : null };
    if (m.active && s.kind === "STOCK" && qty) {
      // Only the part of the sale that came from purchases in the selection.
      for (const l of lots) {
        if (!m.includes("STOCK", s.holdingId, l.lotId) || !l.quantity) continue;
        const share = l.quantity / qty;
        const net = Number(s.netProceeds) * share;
        out.push({ ...base, lotIds: [l.lotId], quantity: l.quantity, gross: Number(s.grossProceeds) * share, charges: Number(s.charges) * share, net, cost: l.cost, realised: net - l.cost });
      }
      continue;
    }
    if (!m.includes(s.kind, s.holdingId, null) && !lots.some((l) => m.includes(s.kind, s.holdingId, l.lotId))) continue;
    out.push({ ...base, lotIds: lots.map((l) => l.lotId), quantity: qty, gross: Number(s.grossProceeds), charges: Number(s.charges), net: Number(s.netProceeds), cost: Number(s.costBasis), realised: Number(s.realizedPnl) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

// ------------------------------------------------------------- performance

/** Last close on or before `date`, or null when the history doesn't reach back that far. */
export function priceOn(series: PricePoint[], date: string): number | null {
  if (!series.length || series[0].d > date) return null;
  let v: number | null = null;
  for (const p of series) {
    if (p.d > date) break;
    v = p.v;
  }
  return v;
}

/** Quantity of a holding held at the close of `date`: purchases made by then,
 * less what was sold by then. Uses current purchases plus purchases sales took from. */
export function heldOn(date: string, current: { id: string; qty: number; date: string }[], sold: { lotId: string | null; qty: number; bought: string; soldOn: string }[], keep: (lotId: string | null) => boolean) {
  let q = 0;
  for (const l of current) if (l.date <= date && keep(l.id)) q += l.qty;
  for (const s of sold) if (s.bought <= date && s.soldOn > date && keep(s.lotId)) q += s.qty;
  return q;
}

// ------------------------------------------------------------------ builder

export async function buildInvestmentReport(userId: string, p: InvestmentReportParams): Promise<Report & { fileName: string }> {
  const today = day(new Date());
  const from = p.from ?? "";
  const to = p.to ?? "";
  if (p.type !== "portfolio") {
    if (!ISO.test(from) || !ISO.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) throw new ValidationError("Choose a start and an end date.");
    if (from > to) throw new ValidationError("The start date is after the end date.");
    if (from > today) throw new ValidationError("The start date is in the future.");
  }
  const d = await load(userId);
  const kinds = new Set(p.assetTypes?.length ? p.assetTypes : ASSET_TYPES);
  const catIds = (p.categoryIds ?? []).filter((c) => c === UNCATEGORISED || d.categories.some((x) => x.id === c));
  const m = membership(d, catIds);
  const conv = toBase(d.fx, d.base);
  const base = d.base;
  const period = `${from} to ${to > today ? today : to}`;
  const filters = [
    kinds.size === ASSET_TYPES.length ? "All asset types" : [...kinds].map((k) => KIND_LABEL[k]).join(", "),
    catIds.length ? `Categories: ${catIds.map((c) => (c === UNCATEGORISED ? "Not in a category" : d.categories.find((x) => x.id === c)!.name)).join(", ")}` : "All categories",
    `Totals in ${base} at today's rates`,
  ];
  const fileStem = `vault-${p.type}-${p.type === "portfolio" ? today : `${from}_${to}`}`;
  const missingFx = new Set<string>();
  const sumBase = (pairs: [number | null, string][]) =>
    pairs.reduce((t, [n, c]) => {
      if (n == null) return t;
      const v = conv(n, c);
      if (v == null) {
        missingFx.add(c);
        return t;
      }
      return t + v;
    }, 0);
  const fxNote = () => (missingFx.size ? [`No exchange rate for ${[...missingFx].join(", ")} to ${base}: those amounts are in the rows but left out of the ${base} totals.`] : []);
  const overlapNote = catIds.length > 1 ? ["A holding in more than one of the chosen categories is counted once."] : [];

  switch (p.type) {
    case "portfolio": {
      const hs = holdings(d, kinds, m);
      const valueBase = (h: Holding) => conv(h.value, h.currency);
      const totalValue = sumBase(hs.map((h) => [h.value, h.currency]));
      const totalCost = sumBase(hs.map((h) => [h.invested, h.currency]));
      const columns: ReportColumn[] = [
        { key: "name", label: "Instrument", kind: "text" },
        { key: "ticker", label: "Ticker / ID", kind: "text", csvOnly: true },
        { key: "assetType", label: "Type", kind: "text" },
        { key: "exchange", label: "Exchange", kind: "text", csvOnly: true },
        { key: "categories", label: "Categories", kind: "text" },
        { key: "quantity", label: "Quantity", kind: "number" },
        { key: "avgCost", label: "Avg cost", kind: "money", currencyKey: "currency", decimals: 4 },
        { key: "invested", label: "Cost basis", kind: "money", currencyKey: "currency" },
        { key: "price", label: "Price", kind: "money", currencyKey: "currency", decimals: 4 },
        { key: "priceAsOf", label: "Price as of (UTC)", kind: "date", csvOnly: true },
        { key: "priceStatus", label: "Valuation", kind: "status" },
        { key: "value", label: "Current value", kind: "money", currencyKey: "currency" },
        { key: "unrealised", label: "Unrealised P/L", kind: "money", currencyKey: "currency" },
        { key: "returnPct", label: "Return", kind: "pct" },
        { key: "allocation", label: "Allocation", kind: "pct" },
        { key: "currency", label: "Currency", kind: "text", csvOnly: true },
        { key: "fxRate", label: `Rate to ${base}`, kind: "number", csvOnly: true },
        { key: "valueBase", label: `Value (${base})`, kind: "money", csvOnly: true },
        { key: "unrealisedBase", label: `Unrealised P/L (${base})`, kind: "money", csvOnly: true },
      ];
      const rows = hs.map((h) => {
        const vb = valueBase(h);
        const noPrice = h.status === "No price, valued at cost";
        return {
          name: h.name + (h.part ? ` (${Number(h.part.qty.toFixed(4))} of ${Number(h.part.of.toFixed(4))})` : ""),
          ticker: h.ticker,
          assetType: KIND_LABEL[h.kind],
          exchange: h.exchange ?? "",
          categories: m.names(h.kind, h.id, (h.lots ?? []).map((l) => l.id ?? null)),
          quantity: h.quantity,
          avgCost: h.quantity ? h.invested / h.quantity : null,
          invested: h.invested,
          price: h.price,
          priceAsOf: h.priceAt ? h.priceAt.slice(0, 16).replace("T", " ") : "",
          priceStatus: h.status,
          value: h.value,
          unrealised: noPrice ? null : h.value - h.invested,
          returnPct: noPrice || !(h.invested > 0) ? null : ((h.value - h.invested) / h.invested) * 100,
          allocation: vb != null && totalValue > 0 ? (vb / totalValue) * 100 : null,
          currency: h.currency,
          fxRate: h.currency === base ? 1 : d.fx.rate(h.currency, base),
          valueBase: vb,
          unrealisedBase: noPrice ? null : conv(h.value - h.invested, h.currency),
        };
      });
      const kept = d.sales.filter((s) => !s.reversedAt && !s.accountId).reduce((t, s) => t + (conv(Number(s.netProceeds) - Number(s.creditedNet ?? 0) - (s.reinvestments as unknown as ReinvestmentJson[]).reduce((x, r) => x + Number(r.amount), 0), s.currency) ?? 0), 0);
      return {
        type: p.type,
        fileName: fileStem,
        title: "Current portfolio",
        subtitle: `Snapshot as of ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
        currency: base,
        filters,
        columns,
        rows,
        // In the row's columns too, so the PDF (which shows those) has them: in the report currency.
        totals: { name: `Total (${base})`, invested: totalCost, value: totalValue, unrealised: totalValue - totalCost, returnPct: totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : null, valueBase: totalValue, unrealisedBase: totalValue - totalCost, allocation: hs.length ? 100 : null },
        summary: [
          { label: "Invested", value: totalCost, kind: "money" },
          { label: "Current value", value: totalValue, kind: "money" },
          { label: "Unrealised P/L", value: totalValue - totalCost, kind: "money" },
          { label: "Return", value: totalCost > 0 ? Math.round(((totalValue - totalCost) / totalCost) * 1000) / 10 : "–", kind: totalCost > 0 ? "pct" : "text" },
        ],
        notes: [
          "Amounts in each row are in that holding's own currency; totals are converted to " + base + " at today's rates. Return = unrealised P/L ÷ cost basis of what is held now; realised results are in the trades report.",
          "Holdings without a market price are valued at what was paid and their gain is shown as unknown (blank), not zero. Stale = the last quote is over 4 days old.",
          ...(m.active ? ["With a category filter, a stock split between clients shows only the shares bought for the chosen categories (\"of\" = shares held in total)."] : []),
          ...overlapNote,
          ...(kept > 0.5 && !m.active && kinds.size === ASSET_TYPES.length ? [`Not in this table: ${r2(kept)} ${base} of sale proceeds waiting to be reinvested.`] : []),
          ...fxNote(),
        ],
      };
    }

    case "trades":
    case "transactions": {
      const all = trades(d, kinds, m, p.type === "transactions").filter((t) => t.date >= from && t.date <= to);
      if (p.type === "trades") {
        const columns: ReportColumn[] = [
          { key: "date", label: "Date", kind: "date" },
          { key: "action", label: "Action", kind: "text" },
          { key: "name", label: "Instrument", kind: "text" },
          { key: "ticker", label: "Ticker / ID", kind: "text", csvOnly: true },
          { key: "assetType", label: "Type", kind: "text" },
          { key: "categories", label: "Categories", kind: "text" },
          { key: "quantity", label: "Quantity", kind: "number" },
          { key: "price", label: "Price", kind: "money", currencyKey: "currency", decimals: 4 },
          { key: "gross", label: "Amount", kind: "money", currencyKey: "currency" },
          { key: "charges", label: "Charges", kind: "money", currencyKey: "currency" },
          { key: "net", label: "Net", kind: "money", currencyKey: "currency", csvOnly: true },
          { key: "cost", label: "Cost basis", kind: "money", currencyKey: "currency" },
          { key: "realised", label: "Realised P/L", kind: "money", currencyKey: "currency" },
          { key: "currency", label: "Currency", kind: "text", csvOnly: true },
          { key: "account", label: "Proceeds to", kind: "text", csvOnly: true },
        ];
        const buys = all.filter((t) => t.cost == null);
        const sells = all.filter((t) => t.cost != null);
        return {
          type: p.type,
          fileName: fileStem,
          title: "Executed trades",
          subtitle: period,
          currency: base,
          filters,
          columns,
          rows: all.map((t) => ({ date: t.date, action: t.action, name: t.name, ticker: t.ticker, assetType: KIND_LABEL[t.kind], categories: m.names(t.kind, t.holdingId, t.lotIds), quantity: t.quantity, price: t.price, gross: t.gross, charges: t.charges, net: t.net, cost: t.cost, realised: t.realised, currency: t.currency, account: t.account })),
          summary: [
            { label: "Bought", value: sumBase(buys.map((t) => [t.gross, t.currency])), kind: "money" },
            { label: "Sold (after charges)", value: sumBase(sells.map((t) => [t.net, t.currency])), kind: "money" },
            { label: "Realised P/L", value: sumBase(sells.map((t) => [t.realised, t.currency])), kind: "money" },
            { label: "Trades", value: all.length, kind: "number" },
          ],
          notes: [
            "Purchases show what was bought, including any part sold since. Sales use first-in, first-out cost (or the purchases chosen when selling); realised P/L = net proceeds − cost basis. Undone sales are not trades.",
            ...(m.active ? ["With a category filter, a sale that used purchases from several clients is split by purchase."] : []),
            ...fxNote(),
          ],
        };
      }
      // Transactions: trades plus the money movements and changes behind them.
      type Tx = { date: string; kind: string; name: string; assetType: string; categories: string; quantity: number | null; amount: number | null; currency: string; account: string; status: string; details: string };
      const rows: Tx[] = all.map((t) => ({
        date: t.date, kind: t.action, name: t.name, assetType: KIND_LABEL[t.kind], categories: m.names(t.kind, t.holdingId, t.lotIds), quantity: t.quantity,
        amount: t.cost == null ? -t.gross : t.net, currency: t.currency, account: t.cost == null ? "" : t.account,
        status: t.undoneOn ? `Undone ${t.undoneOn}` : "Done",
        details: t.cost == null ? (t.price != null ? `at ${t.price}` : "") : `cost ${r2(t.cost)}, realised ${r2(t.realised ?? 0)}${t.charges ? `, charges ${r2(t.charges)}` : ""}`,
      }));
      // Undoing a sale is its own event, on the day it was undone.
      for (const t of all) if (t.undoneOn && t.undoneOn >= from && t.undoneOn <= to) rows.push({ date: t.undoneOn, kind: "Sale undone", name: t.name, assetType: KIND_LABEL[t.kind], categories: m.names(t.kind, t.holdingId, t.lotIds), quantity: t.quantity, amount: -t.net, currency: t.currency, account: t.account, status: "Done", details: `sale of ${t.date} reversed` });
      // Reinvestments of kept proceeds.
      for (const s of d.sales) {
        if (!kinds.has(s.kind) || !m.includes(s.kind, s.holdingId, null) && !(s.lots as unknown as SoldLotJson[]).some((l) => m.includes(s.kind, s.holdingId, l.lotId))) continue;
        for (const r of (s.reinvestments as unknown as ReinvestmentJson[]) ?? []) {
          const dt = day(r.date);
          if (dt < from || dt > to) continue;
          rows.push({ date: dt, kind: "Proceeds reinvested", name: s.name, assetType: KIND_LABEL[s.kind], categories: m.names(s.kind, s.holdingId), quantity: null, amount: -Number(r.amount), currency: s.currency, account: "", status: s.reversedAt ? "Sale undone" : "Done", details: `into ${r.into}` });
        }
      }
      // Account movements: payments for purchases and sale proceeds, with any reversals.
      const lotOwner = new Map<string, { kind: InvestmentKind; holdingId: string }>();
      for (const h of d.stocks) for (const l of h.lots) lotOwner.set(l.id, { kind: "STOCK", holdingId: h.id });
      for (const f of d.funds) for (const l of f.lots) lotOwner.set(l.id, { kind: "MUTUAL_FUND", holdingId: f.id });
      for (const s of d.sales) for (const l of s.lots as unknown as SoldLotJson[]) if (l.lotId && !lotOwner.has(l.lotId)) lotOwner.set(l.lotId, { kind: s.kind, holdingId: s.holdingId });
      const refOwner = (ref: string | null) => {
        if (!ref) return null;
        const [k, id] = ref.split(":");
        if (k === "STOCK_LOT" || k === "FUND_LOT") return lotOwner.has(id) ? { ...lotOwner.get(id)!, lotId: id } : null;
        if (k === "DEPOSIT") return { kind: "FIXED_DEPOSIT" as const, holdingId: id, lotId: null };
        if (k === "ASSET") return { kind: "OTHER" as const, holdingId: id, lotId: null };
        return null;
      };
      const saleById = new Map(d.sales.map((s) => [s.id, s]));
      for (const e of d.ledger) {
        const dt = day(e.date);
        if (dt < from || dt > to) continue;
        const kindOf = e.type === "REVERSAL" ? e.reversalOf?.type : e.type;
        const ref = e.type === "REVERSAL" ? e.reversalOf?.investmentRef ?? null : e.investmentRef;
        const saleId = e.type === "REVERSAL" ? e.reversalOf?.investmentSaleId ?? null : e.investmentSaleId;
        const owner = kindOf === "INVESTMENT_SALE" ? (saleId && saleById.has(saleId) ? { kind: saleById.get(saleId)!.kind, holdingId: saleById.get(saleId)!.holdingId, lotId: null } : null) : refOwner(ref);
        if (owner && (!kinds.has(owner.kind) || !m.includes(owner.kind, owner.holdingId, owner.lotId))) continue;
        if (!owner && (m.active || kinds.size !== ASSET_TYPES.length)) continue;
        const label = kindOf === "INVESTMENT_PURCHASE" ? (e.type === "REVERSAL" ? "Purchase payment returned" : "Paid from account") : e.type === "REVERSAL" ? "Sale proceeds taken back" : "Sale proceeds to account";
        rows.push({
          date: dt, kind: label, name: e.description ?? "", assetType: owner ? KIND_LABEL[owner.kind] : "", categories: owner ? m.names(owner.kind, owner.holdingId, [owner.lotId]) : "", quantity: null,
          amount: kindOf === "INVESTMENT_PURCHASE" ? (e.type === "REVERSAL" ? Number(e.amount) : -Number(e.amount)) : e.type === "REVERSAL" ? -Number(e.amount) : Number(e.amount),
          currency: e.currency, account: e.account?.name ?? "", status: e.reversedAt ? "Reversed" : "Done", details: "Account ledger",
        });
      }
      rows.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
      return {
        type: p.type,
        fileName: fileStem,
        title: "Investment transactions",
        subtitle: period,
        currency: base,
        filters,
        columns: [
          { key: "date", label: "Date", kind: "date" },
          { key: "kind", label: "Transaction", kind: "text" },
          { key: "name", label: "Instrument", kind: "text" },
          { key: "assetType", label: "Type", kind: "text" },
          { key: "categories", label: "Categories", kind: "text" },
          { key: "quantity", label: "Quantity", kind: "number" },
          { key: "amount", label: "Amount", kind: "money", currencyKey: "currency" },
          { key: "currency", label: "Currency", kind: "text", csvOnly: true },
          { key: "account", label: "Account", kind: "text" },
          { key: "status", label: "Status", kind: "status" },
          { key: "details", label: "Details", kind: "text", csvOnly: true },
        ],
        rows,
        summary: [{ label: "Transactions", value: rows.length, kind: "number" }],
        notes: [
          "Amount: money out of your investments is negative (purchases, reinvestments), money in is positive (sales). Account rows are the matching movements in your accounts; reversals appear as their own rows, nothing is deleted.",
          ...fxNote(),
        ],
      };
    }

    case "categories": {
      const hs = holdings(d, kinds, membership(d, []));
      const cats = d.categories.filter((c) => !catIds.length || catIds.includes(c.id));
      const salesInPeriod = d.sales.filter((s) => !s.reversedAt && kinds.has(s.kind) && (!from || day(s.soldOn) >= from) && (!to || day(s.soldOn) <= to));
      const rows: Record<string, string | number | null>[] = [];
      const portfolio = sumBase(hs.map((h) => [h.value, h.currency]));
      const addGroup = (label: string, members: Holding[], realised: number | null) => {
        const inv = sumBase(members.map((h) => [h.invested, h.currency]));
        const val = sumBase(members.map((h) => [h.value, h.currency]));
        rows.push({ _style: "subtotal", category: label, name: `${members.length} ${members.length === 1 ? "holding" : "holdings"}`, assetType: null, quantity: null, invested: inv, value: val, unrealised: val - inv, returnPct: inv > 0 ? ((val - inv) / inv) * 100 : null, allocation: portfolio > 0 ? (val / portfolio) * 100 : null, realised, rowType: "category" });
        for (const h of members) {
          const vi = conv(h.invested, h.currency), vv = conv(h.value, h.currency);
          const noPrice = h.status === "No price, valued at cost";
          rows.push({ category: label, name: h.name, assetType: KIND_LABEL[h.kind], quantity: h.part ? `${Number(h.part.qty.toFixed(4))} of ${Number(h.part.of.toFixed(4))}` : h.quantity != null ? String(Number(h.quantity.toFixed(6))) : "", invested: vi, value: vv, unrealised: noPrice || vi == null || vv == null ? null : vv - vi, returnPct: noPrice || !(h.invested > 0) ? null : ((h.value - h.invested) / h.invested) * 100, allocation: vv != null && portfolio > 0 ? (vv / portfolio) * 100 : null, realised: null, rowType: "holding" });
        }
      };
      for (const c of cats) {
        const mc = membership(d, [c.id]);
        const members = holdings(d, kinds, mc);
        // A sale counts fully when the whole holding is in the category; for a
        // stock split by client, only the part that came from its purchases.
        const realised = salesInPeriod.reduce((t, s) => {
          if (mc.includes(s.kind, s.holdingId, null)) return t + (conv(Number(s.realizedPnl), s.currency) ?? 0);
          if (s.kind !== "STOCK" || !s.quantity) return t;
          const lots = s.lots as unknown as SoldLotJson[];
          return t + lots.reduce((x, l) => (l.quantity && mc.includes("STOCK", s.holdingId, l.lotId) ? x + (conv((Number(s.netProceeds) * l.quantity) / Number(s.quantity) - l.cost, s.currency) ?? 0) : x), 0);
        }, 0);
        addGroup(c.name, members, realised);
      }
      if (!catIds.length || catIds.includes(UNCATEGORISED)) addGroup("Not in a category", holdings(d, kinds, membership(d, [UNCATEGORISED])), null);
      // The chosen categories together, each holding (or share) once; with no
      // filter that is the whole portfolio.
      const union = catIds.length ? holdings(d, kinds, m) : hs;
      const totalInv = sumBase(union.map((h) => [h.invested, h.currency]));
      const totalVal = sumBase(union.map((h) => [h.value, h.currency]));
      return {
        type: p.type,
        fileName: fileStem,
        title: "Portfolio by category",
        subtitle: from && to ? `Holdings as of ${today}; realised P/L ${period}` : `As of ${today}`,
        currency: base,
        filters,
        columns: [
          { key: "category", label: "Category", kind: "text" },
          { key: "name", label: "Holding", kind: "text" },
          { key: "assetType", label: "Type", kind: "text" },
          { key: "quantity", label: "Quantity", kind: "text" },
          { key: "invested", label: "Invested", kind: "money" },
          { key: "value", label: "Current value", kind: "money" },
          { key: "unrealised", label: "Unrealised P/L", kind: "money" },
          { key: "returnPct", label: "Return", kind: "pct" },
          { key: "allocation", label: "Of portfolio", kind: "pct" },
          { key: "realised", label: "Realised in period", kind: "money" },
          { key: "rowType", label: "Row", kind: "text", csvOnly: true },
        ],
        rows,
        totals: { category: catIds.length ? "Chosen categories (each holding once)" : "Portfolio (each holding once)", invested: totalInv, value: totalVal, unrealised: totalVal - totalInv, returnPct: totalInv > 0 ? ((totalVal - totalInv) / totalInv) * 100 : null, allocation: portfolio > 0 ? (totalVal / portfolio) * 100 : null, rowType: "total" },
        summary: [
          { label: "Portfolio value", value: portfolio, kind: "money" },
          { label: "Categories", value: cats.length, kind: "number" },
        ],
        notes: [
          `All amounts in ${base} at today's rates. A holding in two categories is counted fully in each, so category rows can add up to more than the total; the total counts every holding once. "Of portfolio" is a share of the whole portfolio (${r2(portfolio)} ${base}). For stocks split by client, a category holds only the shares bought for it.`,
          ...fxNote(),
        ],
      };
    }

    case "performance": {
      const end = to > today ? today : to;
      // Value at the close of the day before the period starts.
      const startDay = day(new Date(Date.parse(`${from}T00:00:00Z`) - 86_400_000));
      const live = d.sales.filter((s) => !s.reversedAt);
      const series = new Map<string, PricePoint[]>();
      const keyFor = (kind: InvestmentKind, idOrTicker: string | null) => (kind === "STOCK" && idOrTicker ? `stock:${idOrTicker.trim().toUpperCase()}` : kind === "MUTUAL_FUND" && idOrTicker ? `mf:${idOrTicker.trim()}` : null);
      const needed = new Set<string>();
      for (const h of d.stocks) needed.add(keyFor("STOCK", h.ticker)!);
      for (const f of d.funds) if (f.schemeCode) needed.add(keyFor("MUTUAL_FUND", f.schemeCode)!);
      for (const s of live) {
        const snap = s.snapshot as Record<string, string | null>;
        if (s.kind === "STOCK") needed.add(keyFor("STOCK", String(snap.ticker ?? s.name))!);
        if (s.kind === "MUTUAL_FUND" && snap.schemeCode) needed.add(keyFor("MUTUAL_FUND", snap.schemeCode)!);
      }
      const keys = [...needed];
      for (let i = 0; i < keys.length; i += 6) {
        const batch = keys.slice(i, i + 6);
        const got = await Promise.all(batch.map((k) => priceHistory(k).catch(() => [])));
        batch.forEach((k, j) => series.set(k, got[j]));
      }
      const priceAt = (key: string | null, date: string, latest: { price: number | null; at: Date | null }) => {
        if (date >= today && latest.price != null && priceStatus(latest.price, latest.at) === "live") return latest.price;
        return key ? priceOn(series.get(key) ?? [], date) : null;
      };

      type Perf = { name: string; ticker: string; kind: InvestmentKind; holdingId: string; lotIds: (string | null)[]; currency: string; start: number | null; bought: number; sold: number; endV: number | null; basis: string };
      const perf: Perf[] = [];
      const allTrades = trades(d, kinds, m).filter((t) => t.date >= from && t.date <= end);
      const flows = (kind: InvestmentKind, holdingId: string) => {
        const ts = allTrades.filter((t) => t.kind === kind && t.holdingId === holdingId);
        return { bought: ts.filter((t) => t.cost == null).reduce((x, t) => x + t.gross, 0), sold: ts.filter((t) => t.cost != null).reduce((x, t) => x + t.net, 0), lots: ts.flatMap((t) => t.lotIds) };
      };
      // Stocks and funds, held now or sold: quantity at each end × the close then.
      const unitHoldings = new Map<string, { kind: InvestmentKind; name: string; ticker: string; currency: string; key: string | null; current: { id: string; qty: number; date: string }[]; latest: { price: number | null; at: Date | null } }>();
      if (kinds.has("STOCK")) for (const h of d.stocks) unitHoldings.set(`STOCK:${h.id}`, { kind: "STOCK", name: h.ticker, ticker: h.ticker, currency: h.currency, key: keyFor("STOCK", h.ticker), current: h.lots.map((l) => ({ id: l.id, qty: Number(l.quantity), date: day(l.purchaseDate) })), latest: { price: h.lastPrice != null ? Number(h.lastPrice) : null, at: h.lastPriceAt } });
      if (kinds.has("MUTUAL_FUND")) for (const f of d.funds) unitHoldings.set(`MUTUAL_FUND:${f.id}`, { kind: "MUTUAL_FUND", name: f.fundName, ticker: f.schemeCode ?? "", currency: f.currency, key: keyFor("MUTUAL_FUND", f.schemeCode), current: f.lots.map((l) => ({ id: l.id, qty: Number(l.units), date: day(l.purchaseDate) })), latest: { price: f.lastNav != null ? Number(f.lastNav) : null, at: f.lastNavAt } });
      for (const s of live) {
        if ((s.kind !== "STOCK" && s.kind !== "MUTUAL_FUND") || !kinds.has(s.kind) || unitHoldings.has(`${s.kind}:${s.holdingId}`)) continue;
        const snap = s.snapshot as Record<string, string | null>;
        const ticker = s.kind === "STOCK" ? String(snap.ticker ?? s.name) : String(snap.schemeCode ?? "");
        unitHoldings.set(`${s.kind}:${s.holdingId}`, { kind: s.kind, name: s.name, ticker, currency: s.currency, key: keyFor(s.kind, ticker), current: [], latest: { price: null, at: null } });
      }
      for (const [k, u] of unitHoldings) {
        const holdingId = k.split(":")[1];
        const keep = (lotId: string | null) => m.includes(u.kind, holdingId, lotId);
        const sold = live.filter((s) => s.kind === u.kind && s.holdingId === holdingId).flatMap((s) => (s.lots as unknown as SoldLotJson[]).map((l) => ({ lotId: l.lotId, qty: Number(l.quantity ?? 0), bought: day(l.purchaseDate), soldOn: day(s.soldOn) })));
        const q0 = heldOn(startDay, u.current, sold, keep);
        const q1 = heldOn(end, u.current, sold, keep);
        const f = flows(u.kind, holdingId);
        if (!q0 && !q1 && !f.bought && !f.sold) continue;
        const p0 = q0 ? priceAt(u.key, startDay, u.latest) : 0;
        const p1 = q1 ? priceAt(u.key, end, u.latest) : 0;
        perf.push({ name: u.name, ticker: u.ticker, kind: u.kind, holdingId, lotIds: f.lots, currency: u.currency, start: p0 == null ? null : q0 * p0, bought: f.bought, sold: f.sold, endV: p1 == null ? null : q1 * p1, basis: p0 == null || p1 == null ? "Not available: no market price for that date" : "Market prices" });
      }
      // Deposits: accrued value at each end while open.
      if (kinds.has("FIXED_DEPOSIT")) {
        const all = [
          ...d.deposits.map((x) => ({ id: x.id, name: `${x.bank} deposit`, currency: x.currency, principal: Number(x.principal), rate: Number(x.interestRate), start: day(x.startDate), maturity: day(x.maturityDate), closed: null as string | null })),
          ...live.filter((s) => s.kind === "FIXED_DEPOSIT" && !d.deposits.some((x) => x.id === s.holdingId)).map((s) => {
            const snap = s.snapshot as Record<string, string>;
            return { id: s.holdingId, name: `${s.name} deposit`, currency: s.currency, principal: Number(snap.principal), rate: Number(snap.interestRate), start: day(snap.startDate), maturity: day(snap.maturityDate), closed: day(s.soldOn) };
          }),
        ];
        for (const x of all) {
          if (!m.includes("FIXED_DEPOSIT", x.id)) continue;
          const valueOn = (dt: string) => (x.start > dt || (x.closed && x.closed <= dt) ? 0 : fdCurrentValue(x.principal, x.rate, x.start, x.maturity, `${dt}T23:59:00Z`));
          const f = flows("FIXED_DEPOSIT", x.id);
          const v0 = valueOn(startDay), v1 = valueOn(end);
          if (!v0 && !v1 && !f.bought && !f.sold) continue;
          perf.push({ name: x.name, ticker: "", kind: "FIXED_DEPOSIT", holdingId: x.id, lotIds: [], currency: x.currency, start: v0, bought: f.bought, sold: f.sold, endV: v1, basis: "Interest accrual" });
        }
      }
      // Other assets: only their purchase price and latest manual valuation are known.
      if (kinds.has("OTHER")) {
        for (const a of d.assets) {
          if (!m.includes("OTHER", a.id)) continue;
          const bought = day(a.purchaseDate);
          const f = flows("OTHER", a.id);
          const heldAtStart = bought <= startDay;
          const endKnown = end >= today;
          if (!heldAtStart && bought > end) continue;
          perf.push({ name: a.name, ticker: a.assetType, kind: "OTHER", holdingId: a.id, lotIds: [], currency: a.currency, start: heldAtStart ? null : 0, bought: f.bought, sold: f.sold, endV: endKnown ? Number(a.currentValue) : null, basis: heldAtStart || !endKnown ? "Not available: valued by hand, no history" : `Manual valuation (${day(a.updatedAt)})` });
        }
        for (const s of live.filter((x) => x.kind === "OTHER" && !d.assets.some((a) => a.id === x.holdingId))) {
          if (!m.includes("OTHER", s.holdingId)) continue;
          const snap = s.snapshot as Record<string, string>;
          const bought = day(snap.purchaseDate), soldOn = day(s.soldOn);
          if (soldOn <= startDay || bought > end) continue;
          const f = flows("OTHER", s.holdingId);
          const heldAtStart = bought <= startDay;
          const heldAtEnd = soldOn > end;
          perf.push({ name: s.name, ticker: String(snap.assetType ?? ""), kind: "OTHER", holdingId: s.holdingId, lotIds: [], currency: s.currency, start: heldAtStart ? null : 0, bought: f.bought, sold: f.sold, endV: heldAtEnd ? null : 0, basis: heldAtStart || heldAtEnd ? "Not available: valued by hand, no history" : "Bought and sold in the period" });
        }
      }
      const rows = perf
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((x) => {
          const ok = x.start != null && x.endV != null;
          const gain = ok ? x.endV! - x.start! - x.bought + x.sold : null;
          const denom = (x.start ?? 0) + x.bought;
          return {
            name: x.name, ticker: x.ticker, assetType: KIND_LABEL[x.kind], categories: m.names(x.kind, x.holdingId, x.lotIds),
            start: x.start, bought: x.bought, sold: x.sold, end: x.endV, gain, returnPct: gain != null && denom > 0 ? (gain / denom) * 100 : null, currency: x.currency, basis: x.basis,
            gainBase: gain == null ? null : conv(gain, x.currency),
          };
        });
      const usable = rows.filter((r) => r.gain != null);
      const skipped = rows.filter((r) => r.gain == null);
      const S = sumBase(usable.map((r) => [r.start, r.currency]));
      const B = sumBase(usable.map((r) => [r.bought, r.currency]));
      const Sd = sumBase(usable.map((r) => [r.sold, r.currency]));
      const E = sumBase(usable.map((r) => [r.end, r.currency]));
      const G = E - S - B + Sd;
      const earliest = [...series.values()].filter((s) => s.length).map((s) => s[0].d).sort()[0];
      return {
        type: p.type,
        fileName: fileStem,
        title: "Portfolio performance",
        subtitle: `${from} to ${end}`,
        currency: base,
        filters,
        columns: [
          { key: "name", label: "Instrument", kind: "text" },
          { key: "ticker", label: "Ticker / ID", kind: "text", csvOnly: true },
          { key: "assetType", label: "Type", kind: "text" },
          { key: "categories", label: "Categories", kind: "text", csvOnly: true },
          { key: "start", label: "Value at start", kind: "money", currencyKey: "currency" },
          { key: "bought", label: "Bought", kind: "money", currencyKey: "currency" },
          { key: "sold", label: "Sold", kind: "money", currencyKey: "currency" },
          { key: "end", label: "Value at end", kind: "money", currencyKey: "currency" },
          { key: "gain", label: "Gain / loss", kind: "money", currencyKey: "currency" },
          { key: "returnPct", label: "Return", kind: "pct" },
          { key: "currency", label: "Currency", kind: "text", csvOnly: true },
          { key: "basis", label: "Valued with", kind: "text" },
          { key: "gainBase", label: `Gain / loss (${base})`, kind: "money", csvOnly: true },
        ],
        rows,
        totals: { name: `Total (${base}, valued rows only)`, start: S, bought: B, sold: Sd, end: E, gain: G, returnPct: S + B > 0 ? (G / (S + B)) * 100 : null, gainBase: G },
        summary: [
          { label: "Value at start", value: S, kind: "money" },
          { label: "Net added", value: B - Sd, kind: "money" },
          { label: "Value at end", value: E, kind: "money" },
          { label: "Gain / loss", value: G, kind: "money" },
          { label: "Return", value: S + B > 0 ? Math.round((G / (S + B)) * 1000) / 10 : "–", kind: S + B > 0 ? "pct" : "text" },
        ],
        notes: [
          "Gain / loss = value at end − value at start − bought + sold in the period (sales after charges). Return = gain ÷ (value at start + bought). Values at start are at the close of the day before the start date.",
          "Stocks and funds are valued at the recorded closing price on or before each date (the stored history is about one year, sampled every few trading days); deposits by their interest. Rows marked Not available had no price for a date and are left out of the totals, never counted as zero.",
          ...(skipped.length ? [`Not valued: ${skipped.map((r) => r.name).join(", ")}.`] : []),
          ...(earliest && from < earliest ? [`Price history starts ${earliest}; holdings held before then can't be valued at the start.`] : []),
          ...fxNote(),
        ],
      };
    }
  }
}
