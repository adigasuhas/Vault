import { describe, it, expect } from "vitest";
import { computeEmi, computeLoanEndDate, amortizationSchedule, monthsBetween } from "@/lib/loans";

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
  it("is the last EMI's date: the first falls on the start date", () => {
    const end = computeLoanEndDate(new Date("2026-01-15T00:00:00Z"), 18);
    expect(end.getUTCFullYear()).toBe(2027);
    expect(end.getUTCMonth()).toBe(5); // June (0-indexed): Jan 2026 + 17 months
  });
});

describe("amortizationSchedule with the user's own EMI", () => {
  const start = new Date("2026-01-15T00:00:00Z");

  it("splits a 0% loan equally by default", () => {
    const rows = amortizationSchedule(12000, 0, 12, start);
    expect(rows).toHaveLength(12);
    expect(rows.every((r) => r.emi === 1000)).toBe(true);
    expect(rows[11].balanceAfter).toBe(0);
  });

  it("puts the rounding remainder on the last EMI", () => {
    const rows = amortizationSchedule(10000, 0, 3, start);
    expect(rows.map((r) => r.emi)).toEqual([3333.33, 3333.33, 3333.34]);
  });

  it("a larger EMI clears the loan early", () => {
    const rows = amortizationSchedule(12000, 0, 12, start, 1500);
    expect(rows).toHaveLength(8);
    expect(rows[7].balanceAfter).toBe(0);
  });

  it("a smaller EMI leaves a bigger final installment", () => {
    const rows = amortizationSchedule(12000, 0, 12, start, 900);
    expect(rows).toHaveLength(12);
    expect(rows[11].emi).toBe(2100);
    expect(rows.reduce((t, r) => t + r.principal, 0)).toBeCloseTo(12000, 2);
  });

  it("first EMI is on the start date; first to last EMI date round-trips", () => {
    expect(amortizationSchedule(12000, 0, 12, start)[0].dueDate.toISOString().slice(0, 10)).toBe("2026-01-15");
    expect(monthsBetween(start, new Date("2027-01-15T00:00:00Z"))).toBe(12);
    const n = monthsBetween(start, new Date("2026-07-15T00:00:00Z")) + 1;
    expect(n).toBe(7);
    expect(computeLoanEndDate(start, n).toISOString().slice(0, 10)).toBe("2026-07-15");
  });
});
