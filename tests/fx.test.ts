import { describe, it, expect, vi, beforeEach } from "vitest";

const findUnique = vi.fn();
const findMany = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: (...a: unknown[]) => findUnique(...a) },
    exchangeRate: {
      findMany: (...a: unknown[]) => findMany(...a),
      // Rates count as fresh, so no network refresh is attempted.
      findFirst: async () => ({ fetchedAt: new Date() }),
    },
  },
}));

import { createFxConverter } from "@/lib/fx";

const rate = (baseCurrency: string, targetCurrency: string, r: number, mode = "AUTOMATIC", fetchedAt = new Date()) => ({
  baseCurrency,
  targetCurrency,
  rate: r,
  mode,
  fetchedAt,
});

beforeEach(() => {
  findUnique.mockReset();
  findMany.mockReset();
  findUnique.mockResolvedValue({ exchangeRateMode: "AUTOMATIC" });
});

describe("createFxConverter", () => {
  it("returns the amount unchanged when from === base", async () => {
    findMany.mockResolvedValue([]);
    const fx = await createFxConverter("u1", "INR");
    expect(fx.convert(1000, "INR")).toBe(1000);
    expect(fx.missing).toEqual([]);
  });

  it("applies a direct rate", async () => {
    findMany.mockResolvedValue([rate("USD", "INR", 83.5)]);
    const fx = await createFxConverter("u1", "INR");
    expect(fx.convert(100, "USD")).toBe(8350);
  });

  it("prefers the user's configured mode over another mode", async () => {
    findUnique.mockResolvedValue({ exchangeRateMode: "MANUAL" });
    findMany.mockResolvedValue([
      rate("USD", "INR", 90, "MANUAL"),
      rate("USD", "INR", 83, "AUTOMATIC"),
    ]);
    const fx = await createFxConverter("u1", "INR");
    expect(fx.convert(1, "USD")).toBe(90);
  });

  it("falls back to an inverse rate", async () => {
    findMany.mockResolvedValue([rate("INR", "USD", 0.012)]);
    const fx = await createFxConverter("u1", "INR");
    expect(fx.convert(120, "USD")).toBeCloseTo(120 / 0.012, 5);
  });

  it("records a missing pair and returns the amount unconverted (never silently 0)", async () => {
    findMany.mockResolvedValue([]);
    const fx = await createFxConverter("u1", "INR");
    expect(fx.convert(500, "EUR")).toBe(500);
    expect(fx.missing).toEqual(["EUR"]);
  });

  it("treats a non-finite amount as 0", async () => {
    findMany.mockResolvedValue([]);
    const fx = await createFxConverter("u1", "INR");
    expect(fx.convert(Number.NaN, "INR")).toBe(0);
  });
});

describe("cross rates and display conversions", () => {
  it("converts between two non-base currencies through the base", async () => {
    findMany.mockResolvedValue([rate("GBP", "INR", 128), rate("GBP", "USD", 1.33)]);
    const fx = await createFxConverter("u1", "GBP");
    expect(fx.convertTo(133, "USD", "INR")).toBeCloseTo(12800, 6);
    expect(fx.convert(12800, "INR")).toBeCloseTo(100, 6);
  });

  it("returns null instead of inventing a 1:1 rate for display", async () => {
    findMany.mockResolvedValue([]);
    const fx = await createFxConverter("u1", "GBP");
    expect(fx.convertTo(100, "JPY", "GBP")).toBeNull();
    expect(fx.rate("JPY", "INR")).toBeNull();
  });
});
