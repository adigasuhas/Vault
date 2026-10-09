import { describe, expect, it } from "vitest";
import { categoryGrowth, categoryRows, uncategorised, type CategoryLite, type Position, type SaleLite } from "@/lib/category-metrics";
import { fdCurrentValue } from "@/lib/investments";

const toBase = (n: number, c: string) => (c === "USD" ? n * 80 : n);

const stock: Position = { kind: "STOCK", id: "s1", name: "TCS", currency: "INR", invested: 1000, value: 1500, lots: [{ qty: 10, cost: 1000, date: "2026-01-10" }] };
const usStock: Position = { kind: "STOCK", id: "s2", name: "AAPL", currency: "USD", invested: 100, value: 120, lots: [{ qty: 1, cost: 100, date: "2026-03-01" }] };
const fund: Position = { kind: "MUTUAL_FUND", id: "f1", name: "Index", currency: "INR", invested: 2000, value: 1800, lots: [{ qty: 100, cost: 2000, date: "2026-02-01" }] };
const fd: Position = { kind: "FIXED_DEPOSIT", id: "d1", name: "HDFC", currency: "INR", invested: 10000, value: 10400, deposit: { principal: 10000, rate: 8, start: "2026-01-01", maturity: "2027-01-01" } };
const gold: Position = { kind: "OTHER", id: "o1", name: "Gold", currency: "INR", invested: 5000, value: 6000, valuedOn: "2026-09-01" };
const positions = [stock, usStock, fund, fd, gold];

const cat = (id: string, name: string, links: [Position["kind"], string][]): CategoryLite => ({ id, name, color: 1, links: links.map(([kind, holdingId]) => ({ kind, holdingId })) });

describe("categoryRows", () => {
  const tech = cat("c1", "Tech", [["STOCK", "s1"], ["STOCK", "s2"]]);
  const mine = cat("c2", "Mine", [["STOCK", "s1"], ["MUTUAL_FUND", "f1"], ["FIXED_DEPOSIT", "d1"], ["OTHER", "o1"]]);
  const total = positions.reduce((t, p) => t + toBase(p.value, p.currency), 0);

  it("adds up only the category's holdings, across all four types and currencies", () => {
    const [t, m] = categoryRows([tech, mine], positions, [], toBase, total);
    expect(t.count).toBe(2);
    expect(t.invested).toBe(1000 + 8000);
    expect(t.value).toBe(1500 + 9600);
    expect(t.pnl).toBe(t.value - t.invested);
    expect(t.pct).toBeCloseTo((2100 / 9000) * 100);
    expect(m.count).toBe(4);
    expect(m.invested).toBe(1000 + 2000 + 10000 + 5000);
    expect(m.value).toBe(1500 + 1800 + 10400 + 6000);
  });

  it("allocation is a share of the whole portfolio; overlapping categories can exceed 100%", () => {
    const rows = categoryRows([tech, mine], positions, [], toBase, total);
    expect(rows[0].allocation).toBeCloseTo((11100 / total) * 100);
    const sum = rows.reduce((t, r) => t + r.allocation, 0);
    expect(sum).toBeGreaterThan(100 * ((11100 + 19700) / total) - 0.001);
    // TCS is in both: counted fully in each, never split.
    expect(rows[0].value + rows[1].value).toBeGreaterThan(total - 1);
  });

  it("notes hand-valued holdings with their oldest valuation date", () => {
    const [, m] = categoryRows([tech, mine], positions, [], toBase, total);
    expect(m.manual).toBe(1);
    expect(m.oldestValuation).toBe("2026-09-01");
  });

  it("keeps realised results of sold holdings in their categories, ignoring undone sales", () => {
    const sales: SaleLite[] = [
      { kind: "STOCK", holdingId: "s9", currency: "USD", realizedPnl: 10, reversedAt: null },
      { kind: "STOCK", holdingId: "s9", currency: "USD", realizedPnl: 99, reversedAt: "2026-05-01" },
      { kind: "STOCK", holdingId: "other", currency: "INR", realizedPnl: 50, reversedAt: null },
    ];
    const sold = cat("c3", "Sold", [["STOCK", "s9"]]);
    const [r] = categoryRows([sold], positions, sales, toBase, total);
    expect(r.count).toBe(0);
    expect(r.realized).toBe(800);
    expect(r.soldCount).toBe(1);
    expect(r.pct).toBeNull();
  });

  it("lists holdings in no category", () => {
    expect(uncategorised([tech], positions).map((p) => p.id)).toEqual(["f1", "d1", "o1"]);
  });
});

describe("categoryGrowth", () => {
  const series = {
    s1: [
      { d: "2026-01-05", v: 90 },
      { d: "2026-01-12", v: 110 },
      { d: "2026-02-02", v: 120 },
      { d: "2026-03-02", v: 150 },
    ],
    f1: [
      { d: "2026-01-02", v: 20 },
      { d: "2026-02-02", v: 19 },
      { d: "2026-03-02", v: 18 },
    ],
  };

  it("values holdings at real past prices from the day each was bought", () => {
    const g = categoryGrowth([stock, fund], series, toBase, {}, "2026-03-02");
    const at = (d: string) => g.points.find((p) => p.d === d)!;
    // Starts from the first purchase, not before.
    expect(g.points[0].d).toBe("2026-01-10");
    expect(at("2026-01-12")).toEqual({ d: "2026-01-12", value: 1100, invested: 1000 });
    expect(at("2026-02-02")).toEqual({ d: "2026-02-02", value: 1200 + 1900, invested: 3000 });
    expect(at("2026-03-02").value).toBe(1500 + 1800);
  });

  it("never invents history: hand-valued and unpriced holdings are left out with a reason", () => {
    const nav = { ...fund, id: "f2" };
    const g = categoryGrowth([stock, gold, nav], series, toBase, {}, "2026-03-02");
    expect(g.charted.map((p) => p.id)).toEqual(["s1"]);
    expect(g.skipped.map((s) => s.position.id)).toEqual(["o1", "f2"]);
    expect(g.skipped[0].reason).toBe("valued by hand");
    expect(g.skipped[0].position.valuedOn).toBe("2026-09-01");
  });

  it("clips to the selected period", () => {
    const g = categoryGrowth([stock], series, toBase, { from: "2026-02-01", to: "2026-02-28" }, "2026-03-02");
    expect(g.points[0].d).toBe("2026-02-01");
    expect(g.points.at(-1)!.d).toBe("2026-02-28");
    expect(g.points.every((p) => p.d >= "2026-02-01" && p.d <= "2026-02-28")).toBe(true);
  });

  it("starts where every holding has a price", () => {
    const late = { ...stock, id: "s3", lots: [{ qty: 1, cost: 10, date: "2025-06-01" }] };
    const g = categoryGrowth([late], { s3: [{ d: "2026-01-05", v: 10 }, { d: "2026-01-06", v: 11 }] }, toBase, {}, "2026-01-06");
    expect(g.historyFrom).toBe("2026-01-05");
    expect(g.points[0].d).toBe("2026-01-05");
  });

  it("values deposits by their accrual", () => {
    const g = categoryGrowth([fd], {}, toBase, {}, "2026-07-01");
    expect(g.points[0].d).toBe("2026-01-01");
    const last = g.points.at(-1)!;
    expect(last.d).toBe("2026-07-01");
    expect(last.value).toBeCloseTo(fdCurrentValue(10000, 8, "2026-01-01", "2027-01-01", "2026-07-01T12:00:00Z"));
    expect(last.invested).toBe(10000);
  });
});
