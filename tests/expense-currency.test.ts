import { describe, it, expect, vi } from "vitest";

// ledger.ts imports @/lib/db at module load; the helpers here are pure.
vi.mock("@/lib/db", () => ({ db: {} }));

import { expenseBooking, spendOf } from "@/lib/ledger";
import { ValidationError } from "@/lib/validate";

describe("expenseBooking", () => {
  it("posts a same-currency expense as is, with no rate", () => {
    expect(expenseBooking(250, "INR", "INR")).toEqual({ postAmount: 250, accountAmount: null, exchangeRate: null });
    // A rate sent along for a same-currency expense is ignored.
    expect(expenseBooking(250, "INR", "INR", 0.5).exchangeRate).toBeNull();
  });

  it("requires a confirmed rate when the account is in another currency", () => {
    expect(() => expenseBooking(1000, "INR", "GBP")).toThrow(ValidationError);
    expect(() => expenseBooking(1000, "INR", "GBP", 0)).toThrow(/Confirm the exchange rate/);
    expect(() => expenseBooking(1000, "INR", "GBP", Number.NaN)).toThrow(ValidationError);
  });

  it("converts at the confirmed rate, rounded to the cent", () => {
    // ₹1,000 from a £ card at 1 GBP = 110.25 INR.
    const b = expenseBooking(1000, "INR", "GBP", 1 / 110.25);
    expect(b.postAmount).toBe(9.07);
    expect(b.accountAmount).toBe(9.07);
    expect(b.exchangeRate).toBeCloseTo(0.0090703, 7);
  });

  it("keeps the exact figure taken from the account when it agrees with the rate", () => {
    const b = expenseBooking(1000, "INR", "GBP", 9.08 / 1000, 9.08);
    expect(b.postAmount).toBe(9.08);
  });

  it("refuses a figure that doesn't match its rate", () => {
    expect(() => expenseBooking(1000, "INR", "GBP", 1 / 110.25, 12)).toThrow(/doesn't match/);
  });

  it("refuses a rate that rounds the debit to nothing", () => {
    expect(() => expenseBooking(0.01, "INR", "GBP", 0.0001)).toThrow(/less than 0.01/);
  });

  it("works the other way round: dollars reported, rupees debited", () => {
    expect(expenseBooking(12.5, "USD", "INR", 83.4).postAmount).toBe(1042.5);
  });
});

describe("spendOf", () => {
  it("counts a converted expense at the amount the user reported", () => {
    expect(spendOf({ amount: "9.07", currency: "GBP", expense: { amount: "1000", currency: "INR" } })).toEqual({ amount: 1000, currency: "INR" });
  });

  it("uses the ledger figure otherwise", () => {
    expect(spendOf({ amount: "40", currency: "INR", expense: { amount: "40", currency: "INR" } })).toEqual({ amount: 40, currency: "INR" });
    expect(spendOf({ amount: "15", currency: "GBP", expense: null })).toEqual({ amount: 15, currency: "GBP" });
    expect(spendOf({ amount: "15", currency: "GBP" })).toEqual({ amount: 15, currency: "GBP" });
  });
});
