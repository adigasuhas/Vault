import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { nthOccurrence, occurrencesBetween, neighbours, defaultStartDate, addMonthsUTC, monthsBetween } from "@/lib/dates";
import { projectSchedule, validateOverrideDate } from "@/lib/schedules";
import { signedAmount, assertSufficientFunds, isLiabilityAccount } from "@/lib/ledger";
import { ValidationError } from "@/lib/validate";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const iso = (x: Date) => x.toISOString().slice(0, 10);

describe("calendar arithmetic", () => {
  it("clamps month-end without drifting", () => {
    expect(iso(addMonthsUTC(d("2026-01-31"), 1))).toBe("2026-02-28");
    // anchored on the 31st: March is the 31st again, not the 28th
    expect(iso(nthOccurrence(d("2026-01-31"), "MONTHLY", 2))).toBe("2026-03-31");
    expect(iso(nthOccurrence(d("2028-01-31"), "MONTHLY", 1))).toBe("2028-02-29");
  });
  it("generates occurrences in a window and honours the end date", () => {
    const rule = { startDate: d("2026-01-05"), frequency: "QUARTERLY" as const, endDate: d("2026-12-31") };
    expect(occurrencesBetween(rule, d("2026-01-01"), d("2027-12-31")).map(iso)).toEqual(["2026-01-05", "2026-04-05", "2026-07-05", "2026-10-05"]);
  });
  it("finds neighbouring occurrences", () => {
    const { prev, next } = neighbours({ startDate: d("2026-01-05"), frequency: "QUARTERLY" }, d("2026-04-05"));
    expect(iso(prev!)).toBe("2026-01-05");
    expect(iso(next!)).toBe("2026-07-05");
  });
  it("suggests sensible first dates", () => {
    const today = d("2026-10-06"); // a Tuesday
    for (const f of ["MONTHLY", "QUARTERLY", "HALF_YEARLY", "YEARLY", "WEEKLY", "ONE_TIME"] as const) {
      expect(iso(defaultStartDate(f, today))).toBe(iso(today));
    }
  });
  it("lists months inclusively", () => {
    expect(monthsBetween("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });
});

describe("override validation", () => {
  const s = { startDate: d("2026-01-05"), frequency: "QUARTERLY" as const, customIntervalDays: null };
  it("allows moving within the period", () => {
    expect(() => validateOverrideDate(s, d("2026-04-05"), d("2026-04-20"))).not.toThrow();
  });
  it("rejects moving past a neighbour", () => {
    expect(() => validateOverrideDate(s, d("2026-04-05"), d("2026-07-10"))).toThrow(ValidationError);
    expect(() => validateOverrideDate(s, d("2026-04-05"), d("2026-01-05"))).toThrow(ValidationError);
  });
});

describe("projectSchedule", () => {
  const base = {
    id: "s1",
    userId: "u",
    direction: "INCOME" as const,
    kind: "STIPEND",
    name: "Stipend",
    notes: null,
    categoryId: null,
    loanId: null,
    amount: 37000 as unknown as never,
    currency: "INR",
    receivingAccountId: "a1",
    frequency: "QUARTERLY" as const,
    customIntervalDays: null,
    startDate: d("2026-01-05"),
    endDate: null,
    nextExecutionDate: d("2026-07-05"),
    isActive: true,
    requiresConfirmation: true,
    cancelledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  it("merges history, overrides and projections", () => {
    const out = projectSchedule(
      {
        ...base,
        overrides: [{ id: "o", scheduledCreditId: "s1", occurrenceDate: d("2026-10-05"), date: d("2026-10-12"), amount: 40000 as never, createdAt: new Date(), updatedAt: new Date() }],
        executions: [
          { id: "x1", scheduledCreditId: "s1", executedDate: d("2026-01-05"), occurrenceDate: d("2026-01-05"), confirmedAt: new Date(), reversedAt: null, amount: 36500 as never, status: "CONFIRMED", note: null, failureReason: null, bookedAmount: null, bookedCurrency: null },
          { id: "x2", scheduledCreditId: "s1", executedDate: d("2026-04-05"), occurrenceDate: d("2026-04-05"), confirmedAt: new Date(), reversedAt: null, amount: 37000 as never, status: "SKIPPED", note: null, failureReason: null, bookedAmount: null, bookedCurrency: null },
        ],
      },
      d("2026-01-01"),
      d("2026-12-31")
    );
    expect(out.map((o) => [o.date, o.status, o.amount])).toEqual([
      ["2026-01-05", "CONFIRMED", 36500],
      ["2026-04-05", "SKIPPED", 37000],
      ["2026-07-05", "SCHEDULED", 37000],
      ["2026-10-12", "SCHEDULED", 40000],
    ]);
    expect(out[3].overridden).toBe(true);
  });
  it("projects nothing for a paused schedule", () => {
    const out = projectSchedule({ ...base, isActive: false, overrides: [], executions: [] }, d("2026-01-01"), d("2026-12-31"));
    expect(out).toEqual([]);
  });
});

describe("ledger rules", () => {
  it("signs entries by type", () => {
    expect(signedAmount("EXPENSE", 10)).toBe(-10);
    expect(signedAmount("TRANSFER_OUT", 10)).toBe(-10);
    expect(signedAmount("INCOME", 10)).toBe(10);
    expect(signedAmount("REVERSAL", -10)).toBe(-10);
    expect(signedAmount("OPENING", -2000)).toBe(-2000);
  });
  it("blocks overdrawing a debit account but allows a card within its limit", () => {
    const acct = { name: "Savings", accountType: "SAVINGS", currentBalance: 100, currency: "INR" };
    expect(() => assertSufficientFunds(acct, 100)).not.toThrow();
    expect(() => assertSufficientFunds(acct, 100.5)).toThrow(/Insufficient/);
    const card = { name: "Card", accountType: "CREDIT_CARD", currentBalance: -900, currency: "INR", creditLimit: 1000 };
    expect(() => assertSufficientFunds(card, 100)).not.toThrow();
    expect(() => assertSufficientFunds(card, 101)).toThrow(/credit limit/);
    expect(isLiabilityAccount("FOREX_CARD")).toBe(false);
  });
});
