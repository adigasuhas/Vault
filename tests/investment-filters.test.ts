import { describe, expect, it } from "vitest";
import {
  UNCATEGORISED,
  categoryMatcher,
  filterInvestments,
  filterStock,
  inRange,
  periodSummary,
  saleShare,
  type DateRange,
  type SaleLike,
  type Filters,
} from "@/lib/investment-filters";
import type { CategoryLite } from "@/lib/category-metrics";

const toBase = (n: number) => n;

interface Lot { id: string; quantity: string; price: string; purchaseDate: string }
interface Stock { id: string; ticker: string; currency: string; quantity: string; avgBuyPrice: string; purchaseDate: string; lastPrice: string | null; lots: Lot[]; partOf?: number }
interface Sale extends SaleLike { id: string }
const NONE: DateRange = { from: "", to: "" };
const SEP_15_25: DateRange = { from: "2026-09-15", to: "2026-09-25" };

// Stock X: 10 shares for Client A on 5 Sep, 5 for Client B on 20 Sep. Stored
// as the API returns them: UTC midnight of the calendar date.
const lot = (id: string, quantity: number, price: number, day: string): Lot => ({ id, quantity: String(quantity), price: String(price), purchaseDate: `${day}T00:00:00.000Z` });
const stockX: Stock = {
  id: "sx",
  ticker: "X",
  currency: "INR",
  quantity: "15",
  avgBuyPrice: String((10 * 100 + 5 * 120) / 15),
  purchaseDate: "2026-09-05T00:00:00.000Z",
  lastPrice: "150",
  lots: [lot("a1", 10, 100, "2026-09-05"), lot("b1", 5, 120, "2026-09-20")],
};
// Stock Y, all Client A: bought on 15 Sep and on 25 Sep (both range ends) and 26 Sep.
const stockY: Stock = {
  id: "sy",
  ticker: "Y",
  currency: "INR",
  quantity: "6",
  avgBuyPrice: "50",
  purchaseDate: "2026-09-15T00:00:00.000Z",
  lastPrice: "60",
  lots: [lot("a2", 1, 50, "2026-09-15"), lot("a3", 2, 50, "2026-09-25"), lot("a4", 3, 50, "2026-09-26")],
};
// Stock Z is in "Tech" as a whole; one purchase is also Client B's.
const stockZ: Stock = {
  id: "sz",
  ticker: "Z",
  currency: "INR",
  quantity: "4",
  avgBuyPrice: "10",
  purchaseDate: "2026-08-01T00:00:00.000Z",
  lastPrice: "12",
  lots: [lot("z1", 2, 10, "2026-08-01"), lot("z2", 2, 10, "2026-09-18")],
};

const clientA: CategoryLite = { id: "A", name: "Client A", color: 1, links: [], lotLinks: [{ lotId: "a1" }, { lotId: "a2" }, { lotId: "a3" }, { lotId: "a4" }] };
const clientB: CategoryLite = { id: "B", name: "Client B", color: 2, links: [], lotLinks: [{ lotId: "b1" }, { lotId: "z2" }] };
const tech: CategoryLite = { id: "T", name: "Tech", color: 3, links: [{ kind: "STOCK", holdingId: "sz" }, { kind: "MUTUAL_FUND", holdingId: "f1" }] };
const empty: CategoryLite = { id: "E", name: "Nobody yet", color: 4, links: [], lotLinks: [] };
const categories = [clientA, clientB, tech, empty];

const fund: { id: string; fundName: string; currency: string; units: string; avgNav: string; purchaseDate: string; lastNav: string | null; lots: { id: string; units: string; nav: string; purchaseDate: string }[]; partOf?: number } = {
  id: "f1",
  fundName: "Index",
  currency: "INR",
  units: "30",
  avgNav: "20",
  purchaseDate: "2026-09-01T00:00:00.000Z",
  lastNav: "25",
  lots: [
    { id: "fl1", units: "10", nav: "20", purchaseDate: "2026-09-01T00:00:00.000Z" },
    { id: "fl2", units: "20", nav: "20", purchaseDate: "2026-09-16T00:00:00.000Z" },
  ],
};
const deposit = { id: "d1", currency: "INR", principal: "1000", interestRate: "7", startDate: "2026-09-10T00:00:00.000Z", maturityDate: "2027-09-10T00:00:00.000Z" };
const gold = { id: "o1", currency: "INR", purchasePrice: "500", currentValue: "550", purchaseDate: "2026-09-20T00:00:00.000Z" };

// A sale on 22 Sep of 4 of Client A's 5 Sep shares (bought outside the range),
// and one on 10 Sep of Client B's shares from a purchase since used up.
const saleInRange: Sale = {
  id: "s1", kind: "STOCK", holdingId: "sx", soldOn: "2026-09-22T00:00:00.000Z", reversedAt: null, currency: "INR",
  quantity: "4", netProceeds: "560", realizedPnl: "160",
  lots: [{ lotId: "a1", purchaseDate: "2026-09-05T00:00:00.000Z", quantity: 4, cost: 400 }],
};
const saleBefore: Sale = {
  id: "s2", kind: "STOCK", holdingId: "sx", soldOn: "2026-09-10T00:00:00.000Z", reversedAt: null, currency: "INR",
  quantity: "1", netProceeds: "130", realizedPnl: "10",
  lots: [{ lotId: "b0", purchaseDate: "2026-09-02T00:00:00.000Z", quantity: 1, cost: 120 }],
};
// One sale split across two clients' purchases.
const mixedSale: Sale = {
  id: "s3", kind: "STOCK", holdingId: "sx", soldOn: "2026-09-24T00:00:00.000Z", reversedAt: null, currency: "INR",
  quantity: "4", netProceeds: "600", realizedPnl: "180",
  lots: [
    { lotId: "a1", purchaseDate: "2026-09-05T00:00:00.000Z", quantity: 3, cost: 300 },
    { lotId: "b1", purchaseDate: "2026-09-20T00:00:00.000Z", quantity: 1, cost: 120 },
  ],
};
const undone: Sale = { ...saleInRange, id: "s4", reversedAt: "2026-09-23T00:00:00.000Z" };

const data = { stocks: [stockX, stockY, stockZ], funds: [fund], deposits: [deposit], otherAssets: [gold], sales: [saleInRange, saleBefore, mixedSale, undone] };
const filters = (range: DateRange, cat: string): Filters => ({ range, category: categoryMatcher(categories, cat) });
const lotIds = (v: { stocks: Stock[] }) =>
  v.stocks.flatMap((s) => s.lots.map((l) => l.id)).sort();

describe("the Client A / Client B scenario", () => {
  it("does not show Client A's 5 Sep purchase for 15–25 Sep, even though Client B bought the same stock then", () => {
    const v = filterInvestments(data, filters(SEP_15_25, "A"));
    expect(v.stocks.find((s) => s.id === "sx")).toBeUndefined();
    expect(lotIds(v)).toEqual(["a2", "a3"]);
  });

  it("shows Client B's 20 Sep purchase alone, at its own quantity and price", () => {
    const v = filterInvestments(data, filters(SEP_15_25, "B"));
    const x = v.stocks.find((s) => s.id === "sx")!;
    expect(x.lots.map((l) => l.id)).toEqual(["b1"]);
    expect(Number(x.quantity)).toBe(5);
    expect(Number(x.avgBuyPrice)).toBe(120);
    expect(x.partOf).toBe(15);
  });

  it("shows Client A's purchase once the range covers 5 Sep", () => {
    const v = filterInvestments(data, filters({ from: "2026-09-01", to: "2026-09-10" }, "A"));
    expect(lotIds(v)).toEqual(["a1"]);
    expect(Number(v.stocks[0].quantity)).toBe(10);
  });

  it("with only the date filter, narrows the row to the purchases in the period", () => {
    const v = filterInvestments(data, filters(SEP_15_25, ""));
    const x = v.stocks.find((s) => s.id === "sx")!;
    expect(x.lots.map((l) => l.id)).toEqual(["b1"]);
    expect(Number(x.quantity)).toBe(5);
  });

  it("with only the category filter, shows every one of the client's purchases", () => {
    const v = filterInvestments(data, filters(NONE, "A"));
    expect(lotIds(v)).toEqual(["a1", "a2", "a3", "a4"]);
  });

  it("never mixes another client's purchase of the same stock into a row", () => {
    for (const range of [NONE, SEP_15_25, { from: "2026-09-01", to: "2026-09-30" }]) {
      for (const v of [filterInvestments(data, filters(range, "A")), filterInvestments(data, filters(range, "B"))]) {
        const x = v.stocks.find((s) => s.id === "sx");
        if (x) expect(new Set(x.lots.map((l) => (l.id === "a1" ? "A" : "B"))).size).toBe(1);
      }
    }
  });
});

describe("category and date together", () => {
  it("keeps a stock-wide category's purchases only when they're in the period", () => {
    const v = filterInvestments(data, filters(SEP_15_25, "T"));
    expect(v.stocks.map((s) => s.id)).toEqual(["sz"]);
    expect(v.stocks[0].lots.map((l) => l.id)).toEqual(["z2"]);
  });

  it("applies the category to funds, deposits and assets as wholes and the date to each purchase", () => {
    const v = filterInvestments(data, filters(SEP_15_25, "T"));
    expect(v.funds).toHaveLength(1);
    expect(v.funds[0].lots!.map((l) => l.id)).toEqual(["fl2"]);
    expect(Number(v.funds[0].units)).toBe(20);
    expect(v.funds[0].partOf).toBe(30);
    expect(v.funds[0].whole).toBe(fund);
    expect(v.deposits).toHaveLength(0);
    expect(v.otherAssets).toHaveLength(0);
  });

  it("'not in a category' leaves out stock-wide categorised stocks and purchases with a client", () => {
    const v = filterInvestments(data, filters(NONE, UNCATEGORISED));
    expect(v.stocks).toHaveLength(0);
    expect(v.funds).toHaveLength(0);
    expect(v.deposits.map((d) => d.id)).toEqual(["d1"]);
    expect(v.otherAssets.map((a) => a.id)).toEqual(["o1"]);
    const inPeriod = filterInvestments(data, filters(SEP_15_25, UNCATEGORISED));
    expect(inPeriod.deposits).toHaveLength(0);
    expect(inPeriod.otherAssets.map((a) => a.id)).toEqual(["o1"]);
  });

  it("filters sales by their own date and the category of the purchases they used", () => {
    const a = filterInvestments(data, filters(SEP_15_25, "A"));
    // Sold in the period from a purchase made before it: shown.
    expect(a.sales.map((x) => x.id).sort()).toEqual(["s1", "s3", "s4"]);
    const b = filterInvestments(data, filters(SEP_15_25, "B"));
    expect(b.sales.map((x) => x.id)).toEqual(["s3"]);
    const all = filterInvestments(data, filters(NONE, "B"));
    expect(all.sales.map((x) => x.id).sort()).toEqual(["s3"]);
  });
});

describe("empty results and stable options", () => {
  it("returns nothing for a category with no purchases in the period, without touching the categories", () => {
    const before = JSON.stringify(categories);
    const v = filterInvestments(data, filters({ from: "2026-10-01", to: "2026-10-31" }, "A"));
    expect(v.stocks).toHaveLength(0);
    expect(v.sales).toHaveLength(0);
    const e = filterInvestments(data, filters(SEP_15_25, "E"));
    expect(e.stocks.length + e.funds.length + e.deposits.length + e.otherAssets.length + e.sales.length).toBe(0);
    expect(JSON.stringify(categories)).toBe(before);
  });

  it("a category that no longer exists keeps nothing rather than everything", () => {
    const v = filterInvestments(data, filters(NONE, "deleted"));
    expect(v.stocks).toHaveLength(0);
  });

  it("clearing both filters gives back every row untouched", () => {
    const v = filterInvestments(data, filters(NONE, ""));
    expect(v.stocks).toEqual(data.stocks);
    expect(v.funds).toEqual(data.funds);
    expect(v.sales).toEqual(data.sales);
    expect(v.stocks[0]).toBe(stockX);
  });
});

describe("date boundaries", () => {
  it("includes purchases on the first and last day", () => {
    const v = filterInvestments(data, filters(SEP_15_25, "A"));
    expect(lotIds(v)).toEqual(["a2", "a3"]); // 15 and 25 Sep in, 26 Sep out
  });

  it("reads the calendar date the same for timestamps, date-only values and any time of day", () => {
    expect(inRange("2026-09-25", SEP_15_25)).toBe(true);
    expect(inRange("2026-09-25T00:00:00.000Z", SEP_15_25)).toBe(true);
    expect(inRange("2026-09-25T23:59:59.999Z", SEP_15_25)).toBe(true);
    expect(inRange("2026-09-26T00:00:00.000Z", SEP_15_25)).toBe(false);
    expect(inRange("2026-09-14T23:59:59.999Z", SEP_15_25)).toBe(false);
    expect(inRange("2026-09-15T00:00:00.000Z", SEP_15_25)).toBe(true);
  });

  it("handles open-ended ranges", () => {
    expect(inRange("2020-01-01", { from: "", to: "2026-09-25" })).toBe(true);
    expect(inRange("2030-01-01", { from: "2026-09-15", to: "" })).toBe(true);
    expect(inRange("2026-09-14", { from: "2026-09-15", to: "" })).toBe(false);
  });

  it("the same stock bought several times for the same client is split by date", () => {
    const y = filterStock(stockY, filters({ from: "2026-09-25", to: "2026-09-26" }, "A"))!;
    expect(y.lots.map((l) => l.id)).toEqual(["a3", "a4"]);
    expect(Number(y.quantity)).toBe(5);
    expect(y.partOf).toBe(6);
  });

  it("an edited purchase date or category moves the purchase in or out of the results", () => {
    const moved = { ...stockX, lots: [lot("a1", 10, 100, "2026-09-16"), stockX.lots[1]] };
    expect(filterStock(moved, filters(SEP_15_25, "A"))!.lots.map((l) => l.id)).toEqual(["a1"]);
    const reassigned = [{ ...clientA, lotLinks: [] }, { ...clientB, lotLinks: [{ lotId: "a1" }, { lotId: "b1" }] }];
    expect(filterStock(stockX, { range: NONE, category: categoryMatcher(reassigned, "A") })).toBeNull();
    expect(filterStock(stockX, { range: NONE, category: categoryMatcher(reassigned, "B") })).toBe(stockX);
  });
});

describe("the period's figures", () => {
  it("count only purchases and sales that pass both filters", () => {
    const f = filters(SEP_15_25, "A");
    const p = periodSummary(filterInvestments(data, f), data.sales, f, toBase);
    // a2 (1 × 50) and a3 (2 × 50); Y is at 60 now.
    expect(p.bought).toBe(150);
    expect(p.boughtSince).toBe(0);
    expect(p.worth).toBe(180);
    expect(p.boughtCount).toBe(2);
    // s1 in full, s3's Client A share (3 of 4 shares); the undone sale doesn't count.
    expect(p.soldCount).toBe(2);
    expect(p.received).toBeCloseTo(560 + 450);
    expect(p.realized).toBeCloseTo(160 + (450 - 300));
  });

  it("Client B's period: its own purchase, plus its share of the mixed sale", () => {
    const f = filters(SEP_15_25, "B");
    const p = periodSummary(filterInvestments(data, f), data.sales, f, toBase);
    // b1 still held (5 × 120) and z2 (2 × 10); b1's 1 sold share (cost 120) counts as bought then.
    expect(p.bought).toBe(600 + 20 + 120);
    expect(p.boughtSince).toBe(120);
    expect(p.worth).toBe(5 * 150 + 2 * 12);
    expect(p.received).toBeCloseTo(150);
    expect(p.realized).toBeCloseTo(30);
  });

  it("with no category, a sale counts in full by its date", () => {
    const f = filters(SEP_15_25, "");
    const p = periodSummary(filterInvestments(data, f), data.sales, f, toBase);
    expect(p.soldCount).toBe(2);
    expect(p.received).toBe(560 + 600);
    expect(p.realized).toBe(160 + 180);
  });

  it("saleShare splits a sale by the purchases in the category", () => {
    expect(saleShare(mixedSale, categoryMatcher(categories, "A"))).toEqual({ net: 450, realized: 150 });
    expect(saleShare(mixedSale, categoryMatcher(categories, "E"))).toBeNull();
    expect(saleShare(mixedSale, null)).toEqual({ net: 600, realized: 180 });
  });
});
