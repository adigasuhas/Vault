import { describe, it, expect, vi } from "vitest";

// ledger.ts imports @/lib/db at module load; stub it so the pure helpers can be
// imported without a database.
vi.mock("@/lib/db", () => ({ db: {} }));

import { assertPostable, computeNextExecutionDate } from "@/lib/ledger";
import { ValidationError } from "@/lib/validate";

describe("assertPostable", () => {
  it("passes for a positive same-currency amount", () => {
    expect(() => assertPostable(100, "INR", "INR")).not.toThrow();
  });

  it("rejects zero, negative and non-finite amounts", () => {
    expect(() => assertPostable(0, "INR", "INR")).toThrow(ValidationError);
    expect(() => assertPostable(-5, "INR", "INR")).toThrow(ValidationError);
    expect(() => assertPostable(Number.NaN, "INR", "INR")).toThrow(ValidationError);
  });

  it("rejects a currency mismatch", () => {
    expect(() => assertPostable(100, "USD", "INR")).toThrow(/USD.*INR/);
  });
});

describe("computeNextExecutionDate", () => {
  const from = new Date("2026-01-15T00:00:00Z");

  it("advances by the right interval per frequency", () => {
    expect(computeNextExecutionDate(from, "WEEKLY").toISOString()).toBe("2026-01-22T00:00:00.000Z");
    expect(computeNextExecutionDate(from, "MONTHLY").toISOString()).toBe("2026-02-15T00:00:00.000Z");
    expect(computeNextExecutionDate(from, "QUARTERLY").toISOString()).toBe("2026-04-15T00:00:00.000Z");
    expect(computeNextExecutionDate(from, "HALF_YEARLY").toISOString()).toBe("2026-07-15T00:00:00.000Z");
    expect(computeNextExecutionDate(from, "YEARLY").toISOString()).toBe("2027-01-15T00:00:00.000Z");
  });

  it("uses the custom interval, clamped to [1, 3650] days", () => {
    expect(computeNextExecutionDate(from, "CUSTOM", 10).toISOString()).toBe("2026-01-25T00:00:00.000Z");
    // absurd values are clamped so they can't overflow a Date
    const clampedHigh = computeNextExecutionDate(from, "CUSTOM", 10_000_000);
    expect(clampedHigh.getTime()).toBeLessThan(new Date("2036-02-01").getTime());
    expect(Number.isNaN(clampedHigh.getTime())).toBe(false);
  });

  it("defaults an unknown frequency to one month", () => {
    expect(computeNextExecutionDate(from, "WHATEVER").toISOString()).toBe("2026-02-15T00:00:00.000Z");
  });
});
