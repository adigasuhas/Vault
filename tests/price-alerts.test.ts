import { describe, expect, it } from "vitest";
import { STALE_AFTER_MS, stepAlert, usableQuote, type AlertState } from "@/lib/price-alerts";

const s = (o: Partial<AlertState> = {}): AlertState => ({ targetPrice: 1600, stopLossPrice: 1200, targetArmed: true, stopArmed: true, ...o });

describe("stepAlert", () => {
  it("fires the target once when the price reaches it", () => {
    const a = stepAlert(s(), 1600);
    expect(a).toMatchObject({ fireTarget: true, fireStop: false, targetArmed: false });
    // Same price on the next refresh: quiet.
    expect(stepAlert(s({ targetArmed: false }), 1610)).toMatchObject({ fireTarget: false, targetArmed: false });
  });

  it("re-arms only after a new crossing back below by 1%", () => {
    expect(stepAlert(s({ targetArmed: false }), 1590).targetArmed).toBe(false); // within 1%
    expect(stepAlert(s({ targetArmed: false }), 1583).targetArmed).toBe(true); // below 1584
    // …and then fires again on the next crossing.
    expect(stepAlert(s({ targetArmed: true }), 1601).fireTarget).toBe(true);
  });

  it("fires the stop-loss at or below, and re-arms above by 1%", () => {
    expect(stepAlert(s(), 1200)).toMatchObject({ fireStop: true, stopArmed: false });
    expect(stepAlert(s(), 1150).fireStop).toBe(true);
    expect(stepAlert(s({ stopArmed: false }), 1205).stopArmed).toBe(false);
    expect(stepAlert(s({ stopArmed: false }), 1213).stopArmed).toBe(true);
  });

  it("does nothing between the thresholds", () => {
    expect(stepAlert(s(), 1400)).toEqual({ fireTarget: false, fireStop: false, targetArmed: true, stopArmed: true });
  });

  it("handles a missing threshold", () => {
    expect(stepAlert(s({ targetPrice: null }), 5000)).toMatchObject({ fireTarget: false, fireStop: false });
    expect(stepAlert(s({ stopLossPrice: null }), 1)).toMatchObject({ fireStop: false });
  });
});

describe("usableQuote", () => {
  const now = Date.parse("2026-10-13T10:00:00Z");
  it("rejects missing, zero and stale prices", () => {
    expect(usableQuote(null, new Date(now), now)).toBe(false);
    expect(usableQuote(0, new Date(now), now)).toBe(false);
    expect(usableQuote(100, null, now)).toBe(false);
    expect(usableQuote(100, new Date(now - STALE_AFTER_MS - 1), now)).toBe(false);
  });
  it("accepts a recent quote", () => {
    expect(usableQuote(100, new Date(now - 60_000), now)).toBe(true);
  });
});

import { performance, priceStatus } from "@/lib/price-freshness";
describe("price freshness and performance", () => {
  const now = Date.parse("2026-10-13T10:00:00Z");
  it("labels prices live, stale or missing", () => {
    expect(priceStatus("101.5", "2026-10-12T10:00:00Z", now)).toBe("live");
    expect(priceStatus(101.5, "2026-10-01T10:00:00Z", now)).toBe("stale");
    expect(priceStatus(null, "2026-10-12T10:00:00Z", now)).toBe("none");
    expect(priceStatus(0, "2026-10-12T10:00:00Z", now)).toBe("none");
  });
  it("treats small moves as break-even", () => {
    expect(performance(0.3)).toBe("flat");
    expect(performance(-0.49)).toBe("flat");
    expect(performance(2)).toBe("gain");
    expect(performance(-2)).toBe("loss");
    expect(performance(null)).toBe("flat");
  });
});
