import { fdCurrentValue } from "@/lib/investments";
import { linkKey, type CategoryLite, type InvestmentKind, type ToBase } from "@/lib/category-metrics";

/**
 * The Investments page's date and category filters, worked out purchase by
 * purchase.
 *
 * A stock is a pile of dated purchases (lots), and each purchase can belong to
 * its own category (the client it was bought for) as well as to the stock's
 * stock-wide ones. So both filters are tested against each purchase, and a
 * purchase is shown only when it passes both: being in the period because
 * some *other* purchase of the same stock is (another client's, say) never
 * lets it through. A row left with only some of its purchases shows just
 * those shares at their own cost (`partOf` keeps the whole holding's size).
 *
 * Funds, deposits and other assets are categorised as a whole; fund
 * purchases are still dated one by one. Sales are filtered by the day they
 * were made, and by the category of the purchases they used.
 *
 * These are the history views. Current-holdings figures (portfolio totals,
 * "By category") deliberately ignore the date filter.
 */

export const UNCATEGORISED = "__none__";

export interface DateRange {
  from: string;
  to: string;
}

export const isRanged = (r: DateRange) => !!(r.from || r.to);

/** Money events are stored as UTC midnight of their calendar date (see
 * src/lib/dates.ts), so the ISO prefix is the date itself in any timezone.
 * Plain "YYYY-MM-DD" values work too. Both ends are inclusive. */
export function inRange(date: string, r: DateRange) {
  const day = date.slice(0, 10);
  return (!r.from || day >= r.from) && (!r.to || day <= r.to);
}

export interface CategoryMatch {
  /** A holding as a whole: categorised stock-wide, or a fund, deposit or asset. */
  holding(kind: InvestmentKind, holdingId: string): boolean;
  /** One stock purchase: its own categories plus its stock's stock-wide ones. */
  lot(stockId: string, lotId: string): boolean;
}

/** What a category filter keeps ("" = no filter, so null). A category that
 * no longer exists keeps nothing. */
export function categoryMatcher(categories: Pick<CategoryLite, "id" | "links" | "lotLinks">[], filter: string): CategoryMatch | null {
  if (!filter) return null;
  if (filter === UNCATEGORISED) {
    const linked = new Set(categories.flatMap((c) => c.links.map((l) => linkKey(l.kind, l.holdingId))));
    const lotLinked = new Set(categories.flatMap((c) => (c.lotLinks ?? []).map((l) => l.lotId)));
    return {
      holding: (kind, id) => !linked.has(linkKey(kind, id)),
      lot: (stockId, lotId) => !linked.has(linkKey("STOCK", stockId)) && !lotLinked.has(lotId),
    };
  }
  const cat = categories.find((c) => c.id === filter);
  const keys = new Set((cat?.links ?? []).map((l) => linkKey(l.kind, l.holdingId)));
  const lots = new Set((cat?.lotLinks ?? []).map((l) => l.lotId));
  return {
    holding: (kind, id) => keys.has(linkKey(kind, id)),
    lot: (stockId, lotId) => keys.has(linkKey("STOCK", stockId)) || lots.has(lotId),
  };
}

export interface Filters {
  range: DateRange;
  category: CategoryMatch | null;
}

export const isFiltered = (f: Filters) => isRanged(f.range) || !!f.category;

// ------------------------------------------------------------------ shapes

interface StockLotLike { id: string; quantity: string; price: string; purchaseDate: string }
interface StockLike<L extends StockLotLike> { id: string; quantity: string; avgBuyPrice: string; purchaseDate: string; lots: L[]; partOf?: number }
interface FundLotLike { id: string; units: string; nav: string; purchaseDate: string }
interface FundLike<L extends FundLotLike> { id: string; units: string; avgNav: string; purchaseDate: string; lots?: L[]; partOf?: number }
interface DepositLike { id: string; startDate: string }
interface AssetLike { id: string; purchaseDate: string }
export interface SaleLotLike { lotId: string | null; purchaseDate: string; quantity: number | string | null; cost: number | string }
export interface SaleLike {
  kind: InvestmentKind;
  holdingId: string;
  soldOn: string;
  reversedAt: string | null;
  currency: string;
  quantity: string | number | null;
  netProceeds: string | number;
  realizedPnl: string | number;
  lots: SaleLotLike[];
}

// ------------------------------------------------------------------ rows

/** A stock cut down to the purchases both filters keep, or null if none. */
export function filterStock<L extends StockLotLike, S extends StockLike<L>>(h: S, f: Filters): S | null {
  const keep = (l: L) => inRange(l.purchaseDate, f.range) && (!f.category || f.category.lot(h.id, l.id));
  // A stock saved before purchases were tracked: its one date and its stock-wide categories.
  if (!h.lots.length) return inRange(h.purchaseDate, f.range) && (!f.category || f.category.holding("STOCK", h.id)) ? h : null;
  const lots = h.lots.filter(keep);
  if (!lots.length) return null;
  if (lots.length === h.lots.length) return h;
  const qty = lots.reduce((t, l) => t + Number(l.quantity), 0);
  const cost = lots.reduce((t, l) => t + Number(l.quantity) * Number(l.price), 0);
  return { ...h, lots, quantity: String(qty), avgBuyPrice: String(qty ? cost / qty : 0), partOf: Number(h.quantity) };
}

/** A fund cut down to the purchases made in the period. `whole` is the
 * untouched fund, for redeeming and details. */
export function filterFund<L extends FundLotLike, F extends FundLike<L>>(fund: F, f: Filters): (F & { whole?: F }) | null {
  if (f.category && !f.category.holding("MUTUAL_FUND", fund.id)) return null;
  if (!fund.lots?.length) return inRange(fund.purchaseDate, f.range) ? fund : null;
  const lots = fund.lots.filter((l) => inRange(l.purchaseDate, f.range));
  if (!lots.length) return null;
  if (lots.length === fund.lots.length) return fund;
  const units = lots.reduce((t, l) => t + Number(l.units), 0);
  const cost = lots.reduce((t, l) => t + Number(l.units) * Number(l.nav), 0);
  return { ...fund, lots, units: String(units), avgNav: String(units ? cost / units : 0), partOf: Number(fund.units), whole: fund };
}

/** Whether a sale used purchases in the category. Sales are dated by the
 * day they were made, so this is the category half only. */
export function saleInCategory(x: SaleLike, m: CategoryMatch) {
  if (x.kind !== "STOCK" || !x.lots.length) return m.holding(x.kind, x.holdingId);
  return x.lots.some((l) => (l.lotId ? m.lot(x.holdingId, l.lotId) : m.holding("STOCK", x.holdingId)));
}

export function filterInvestments<
  S extends StockLike<StockLotLike>,
  F extends FundLike<FundLotLike>,
  D extends DepositLike,
  A extends AssetLike,
  X extends SaleLike,
>(data: { stocks: S[]; funds: F[]; deposits: D[]; otherAssets: A[]; sales: X[] }, f: Filters) {
  const m = f.category;
  return {
    stocks: data.stocks.map((h) => filterStock(h, f)).filter((h): h is S => !!h),
    funds: data.funds.map((x) => filterFund(x, f)).filter((x): x is F & { whole?: F } => !!x),
    deposits: data.deposits.filter((d) => inRange(d.startDate, f.range) && (!m || m.holding("FIXED_DEPOSIT", d.id))),
    otherAssets: data.otherAssets.filter((a) => inRange(a.purchaseDate, f.range) && (!m || m.holding("OTHER", a.id))),
    sales: data.sales.filter((x) => inRange(x.soldOn, f.range) && (!m || saleInCategory(x, m))),
  };
}

// ------------------------------------------------------------------ the period's figures

/** The part of a sale that belongs to the category: all of it when every
 * purchase it used is in it, else the share from the purchases that are (by
 * quantity). Null when none are. */
export function saleShare(x: SaleLike, m: CategoryMatch | null): { net: number; realized: number } | null {
  const net = Number(x.netProceeds);
  const realized = Number(x.realizedPnl);
  if (!m) return { net, realized };
  if (x.kind !== "STOCK" || !x.lots.length) return m.holding(x.kind, x.holdingId) ? { net, realized } : null;
  const inCat = (l: SaleLotLike) => (l.lotId ? m.lot(x.holdingId, l.lotId) : m.holding("STOCK", x.holdingId));
  const kept = x.lots.filter(inCat);
  if (!kept.length) return null;
  if (kept.length === x.lots.length) return { net, realized };
  const qty = Number(x.quantity);
  if (!(qty > 0)) return null;
  let shareNet = 0;
  let shareRealized = 0;
  for (const l of kept) {
    const part = (net * Number(l.quantity ?? 0)) / qty;
    shareNet += part;
    shareRealized += part - Number(l.cost);
  }
  return { net: shareNet, realized: shareRealized };
}

interface PricedStock extends StockLike<StockLotLike> { currency: string; lastPrice: string | null }
interface PricedFund extends FundLike<FundLotLike> { currency: string; lastNav: string | null }
interface PricedDeposit extends DepositLike { currency: string; principal: string; interestRate: string; maturityDate: string }
interface PricedAsset extends AssetLike { currency: string; purchasePrice: string; currentValue: string }

export interface PeriodSummary {
  /** Cost of the period's purchases, held or since sold. */
  bought: number;
  /** The part of `bought` that has since been sold. */
  boughtSince: number;
  /** The period's purchases still held, at today's prices. */
  worth: number;
  boughtCount: number;
  soldCount: number;
  received: number;
  realized: number;
}

/**
 * What happened in the period, for the summary cards: from the filtered rows
 * (so only purchases passing both filters) and every sale. A sale counts as
 * "sold in the period" by its own date, even when what it sold was bought
 * earlier; purchases made in the period and sold since still count as bought.
 */
export function periodSummary(
  view: { stocks: PricedStock[]; funds: PricedFund[]; deposits: PricedDeposit[]; otherAssets: PricedAsset[] },
  sales: SaleLike[],
  f: Filters,
  toBase: ToBase,
  now?: string
): PeriodSummary {
  let bought = 0, worth = 0, boughtCount = 0;
  for (const h of view.stocks) {
    const last = Number(h.lastPrice ?? h.avgBuyPrice);
    const lots = h.lots.length ? h.lots : [{ quantity: h.quantity, price: h.avgBuyPrice }];
    for (const l of lots) {
      bought += toBase(Number(l.quantity) * Number(l.price), h.currency);
      worth += toBase(Number(l.quantity) * last, h.currency);
      boughtCount++;
    }
  }
  for (const fund of view.funds) {
    const nav = Number(fund.lastNav ?? fund.avgNav);
    const lots = fund.lots?.length ? fund.lots : [{ units: fund.units, nav: fund.avgNav }];
    for (const l of lots) {
      bought += toBase(Number(l.units) * Number(l.nav), fund.currency);
      worth += toBase(Number(l.units) * nav, fund.currency);
      boughtCount++;
    }
  }
  for (const d of view.deposits) {
    bought += toBase(Number(d.principal), d.currency);
    worth += toBase(fdCurrentValue(Number(d.principal), Number(d.interestRate), d.startDate, d.maturityDate, now), d.currency);
    boughtCount++;
  }
  for (const a of view.otherAssets) {
    bought += toBase(Number(a.purchasePrice), a.currency);
    worth += toBase(Number(a.currentValue), a.currency);
    boughtCount++;
  }
  const m = f.category;
  let boughtSince = 0, soldCount = 0, received = 0, realized = 0;
  for (const x of sales) {
    if (x.reversedAt) continue;
    for (const l of x.lots) {
      if (!inRange(l.purchaseDate, f.range)) continue;
      if (m && !(l.lotId && x.kind === "STOCK" ? m.lot(x.holdingId, l.lotId) : m.holding(x.kind, x.holdingId))) continue;
      boughtSince += toBase(Number(l.cost), x.currency);
    }
    if (!inRange(x.soldOn, f.range)) continue;
    const share = saleShare(x, m);
    if (!share) continue;
    soldCount++;
    received += toBase(share.net, x.currency);
    realized += toBase(share.realized, x.currency);
  }
  return { bought: bought + boughtSince, boughtSince, worth, boughtCount, soldCount, received, realized };
}
