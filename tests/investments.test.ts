import { describe, it, expect, vi, afterEach } from "vitest";
import { fdCurrentValue } from "@/lib/investments";

afterEach(() => vi.useRealTimers());

describe("fdCurrentValue", () => {
  const start = new Date("2026-01-01T00:00:00Z");
  const maturity = new Date("2027-01-01T00:00:00Z");

  it("equals principal before the start date", () => {
    vi.setSystemTime(new Date("2025-12-01T00:00:00Z"));
    expect(fdCurrentValue(100_000, 7, start, maturity)).toBeCloseTo(100_000, 5);
  });

  it("accrues simple interest partway through", () => {
    vi.setSystemTime(new Date("2026-07-02T00:00:00Z")); // ~half a year
    const v = fdCurrentValue(100_000, 7, start, maturity);
    expect(v).toBeGreaterThan(100_000);
    expect(v).toBeLessThan(107_000);
  });

  it("caps at the maturity value after maturity", () => {
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    const atMaturity = 100_000 * (1 + (7 / 100) * (maturity.getTime() - start.getTime()) / (365.25 * 24 * 3600 * 1000));
    expect(fdCurrentValue(100_000, 7, start, maturity)).toBeCloseTo(atMaturity, 2);
  });

  it("accepts ISO strings for the dates", () => {
    vi.setSystemTime(new Date("2026-07-02T00:00:00Z"));
    expect(fdCurrentValue(50_000, 6, "2026-01-01", "2027-01-01")).toBeGreaterThan(50_000);
  });
});
