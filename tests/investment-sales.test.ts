import { describe, it, expect } from "vitest";
import { matchLotsFifo, heldFor } from "@/lib/fifo";
import { createSaleSchema } from "@/lib/schemas";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const lots = [
  { id: "b", quantity: 5, price: 120, purchaseDate: d("2024-06-01") },
  { id: "a", quantity: 10, price: 100, purchaseDate: d("2023-01-15") },
  { id: "c", quantity: 4, price: 150, purchaseDate: d("2025-03-01") },
];

describe("matchLotsFifo", () => {
  it("sells the oldest purchases first", () => {
    const { used, remaining } = matchLotsFifo(lots, 12, d("2025-10-01"));
    expect(used.map((u) => [u.lotId, u.quantity, u.cost])).toEqual([
      ["a", 10, 1000],
      ["b", 2, 240],
    ]);
    expect(remaining).toEqual([
      { id: "a", quantity: 0 },
      { id: "b", quantity: 3 },
    ]);
  });

  it("only uses purchases made by the sale date", () => {
    expect(() => matchLotsFifo(lots, 16, d("2024-12-31"))).toThrow(/held 15/);
    const { used } = matchLotsFifo(lots, 15, d("2024-12-31"));
    expect(used).toHaveLength(2);
  });

  it("rejects a sale before anything was bought", () => {
    expect(() => matchLotsFifo(lots, 1, d("2022-01-01"))).toThrow(/Nothing/);
  });

  it("handles fractional units without float drift", () => {
    const fund = [{ id: "x", quantity: 10.123456, price: 45.67, purchaseDate: d("2024-01-01") }];
    const { used, remaining } = matchLotsFifo(fund, 3.1, d("2025-01-01"));
    expect(used[0].quantity).toBe(3.1);
    expect(remaining[0].quantity).toBe(7.023456);
    expect(used[0].cost).toBe(141.58);
  });

  it("sells a whole holding exactly", () => {
    const { remaining } = matchLotsFifo(lots, 19, d("2025-10-01"));
    expect(remaining.every((r) => r.quantity === 0)).toBe(true);
  });
});

describe("heldFor", () => {
  it("uses days under two months, then months and years", () => {
    expect(heldFor("2025-01-01", "2025-01-31")).toBe("30 days");
    expect(heldFor("2025-01-01", "2025-01-02")).toBe("1 day");
    expect(heldFor("2024-01-15", "2025-04-20")).toBe("1 year 3 months");
    expect(heldFor("2023-05-10", "2025-05-09")).toBe("1 year 11 months");
    expect(heldFor("2023-05-10", "2025-05-10")).toBe("2 years");
  });
});

describe("createSaleSchema", () => {
  const base = { holdingId: "h1", soldOn: "2025-05-01", accountId: "a1" };
  it("needs a quantity and price for shares, an amount for deposits", () => {
    expect(createSaleSchema.safeParse({ ...base, kind: "STOCK", quantity: 5, price: 101.5 }).success).toBe(true);
    expect(createSaleSchema.safeParse({ ...base, kind: "STOCK", amount: 500 }).success).toBe(false);
    expect(createSaleSchema.safeParse({ ...base, kind: "FIXED_DEPOSIT", amount: 105000.5 }).success).toBe(true);
    expect(createSaleSchema.safeParse({ ...base, kind: "FIXED_DEPOSIT", quantity: 1, price: 1 }).success).toBe(false);
  });
  it("rejects bad dates, negative charges and unknown kinds", () => {
    expect(createSaleSchema.safeParse({ ...base, kind: "OTHER", amount: 10, soldOn: "2025-02-30" }).success).toBe(false);
    expect(createSaleSchema.safeParse({ ...base, kind: "OTHER", amount: 10, charges: -1 }).success).toBe(false);
    expect(createSaleSchema.safeParse({ ...base, kind: "BOND", amount: 10 }).success).toBe(false);
  });
});
