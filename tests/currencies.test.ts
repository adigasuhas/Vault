import { describe, it, expect } from "vitest";
import { formatMoney, formatCompactMoney } from "@/lib/currencies";

describe("formatMoney", () => {
  it("uses Indian digit grouping for INR", () => {
    expect(formatMoney(121537, "INR")).toBe("₹1,21,537");
  });

  it("drops the trailing .00 on whole amounts", () => {
    expect(formatMoney(1500, "INR")).not.toContain(".00");
  });

  it("keeps 2 decimals for fractional amounts", () => {
    expect(formatMoney(1500.5, "INR")).toContain(".50");
  });

  it("uses Western grouping for USD", () => {
    expect(formatMoney(121537, "USD")).toBe("$121,537");
  });

  it("has no minor unit for JPY", () => {
    expect(formatMoney(1999.9, "JPY")).toBe("¥2,000");
  });

  it("falls back gracefully for an unknown currency code", () => {
    const out = formatMoney(10, "ZZZ");
    expect(out).toContain("ZZZ");
    expect(out).toContain("10");
  });

  it("treats a non-finite amount as 0", () => {
    expect(formatMoney(Number.NaN, "INR")).toBe("₹0");
  });
});

describe("formatCompactMoney", () => {
  it("uses lakh / crore for INR", () => {
    expect(formatCompactMoney(83_000, "INR")).toBe("₹83k");
    expect(formatCompactMoney(121_537, "INR")).toBe("₹1.2L");
    expect(formatCompactMoney(12_500_000, "INR")).toBe("₹1.3Cr");
  });

  it("uses k / M / B elsewhere", () => {
    expect(formatCompactMoney(2_500, "USD")).toBe("$2.5k");
    expect(formatCompactMoney(3_400_000, "USD")).toBe("$3.4M");
    expect(formatCompactMoney(1_200_000_000, "USD")).toBe("$1.2B");
  });

  it("carries a leading minus sign", () => {
    expect(formatCompactMoney(-150_000, "INR")).toBe("-₹1.5L");
  });

  it("shows small amounts in full", () => {
    expect(formatCompactMoney(742, "INR")).toBe("₹742");
  });
});
