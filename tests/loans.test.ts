import { describe, it, expect } from "vitest";
import { computeEmi, computeLoanEndDate } from "@/lib/loans";

describe("computeEmi", () => {
  it("matches the standard reducing-balance formula", () => {
    // ₹10,00,000 at 9% p.a. over 240 months ≈ ₹8,997.26
    const emi = computeEmi(1_000_000, 9, 240);
    expect(emi).toBeCloseTo(8997.26, 1);
  });

  it("falls back to an equal split when the rate is 0", () => {
    expect(computeEmi(120_000, 0, 12)).toBe(10_000);
  });

  it("returns 0 for non-positive installments", () => {
    expect(computeEmi(100_000, 8, 0)).toBe(0);
    expect(computeEmi(100_000, 8, -5)).toBe(0);
  });

  it("EMI * n is always greater than principal for a positive rate", () => {
    const p = 500_000;
    const emi = computeEmi(p, 12, 60);
    expect(emi * 60).toBeGreaterThan(p);
  });
});

describe("computeLoanEndDate", () => {
  it("adds the installment count in months", () => {
    const end = computeLoanEndDate(new Date("2026-01-15T00:00:00Z"), 18);
    expect(end.getUTCFullYear()).toBe(2027);
    expect(end.getUTCMonth()).toBe(6); // July (0-indexed)
  });
});
