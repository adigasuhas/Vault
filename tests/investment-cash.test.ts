import { describe, expect, it } from "vitest";
import { cashSigned } from "@/lib/investment-cash";
import { fundingSplit as serverSplit, priceWithCharges } from "@/lib/investment-funding";
import { proceedsChoice } from "@/lib/investment-sales";
import { emptyFunding, fundingBody, fundingProblem, fundingSplit } from "@/components/investments/FundingFields";
import { cashMoveSchema, createSaleSchema, createStockSchema } from "@/lib/schemas";
import { signedAmount } from "@/lib/ledger";

const sum = (entries: [string, number][]) => entries.reduce((t, [type, amount]) => t + cashSigned(type, amount), 0);

describe("investment cash balance", () => {
  it("adds sale proceeds and money from accounts, takes purchases and withdrawals", () => {
    expect(cashSigned("SALE_PROCEEDS", 10_000)).toBe(10_000);
    expect(cashSigned("FROM_ACCOUNT", 500)).toBe(500);
    expect(cashSigned("PURCHASE", 7_000)).toBe(-7_000);
    expect(cashSigned("TO_ACCOUNT", 2_000)).toBe(-2_000);
    // Reversals carry their own sign.
    expect(cashSigned("REVERSAL", 7_000)).toBe(7_000);
    expect(cashSigned("REVERSAL", -500)).toBe(-500);
  });

  it("matches the brief: 10,000 kept, 7,000 reinvested, 2,000 withdrawn leaves 1,000", () => {
    expect(sum([["SALE_PROCEEDS", 10_000], ["PURCHASE", 7_000]])).toBe(3_000);
    expect(sum([["SALE_PROCEEDS", 10_000], ["PURCHASE", 7_000], ["TO_ACCOUNT", 2_000]])).toBe(1_000);
  });

  it("an undone entry nets to nothing", () => {
    expect(sum([["PURCHASE", 7_000], ["REVERSAL", 7_000]])).toBe(0);
    expect(sum([["FROM_ACCOUNT", 500], ["REVERSAL", -500]])).toBe(0);
  });

  it("moves between an account and investment cash create no money", () => {
    // Account side and investment cash side of the same move cancel out.
    expect(signedAmount("TO_INVESTMENT_CASH", 500) + cashSigned("FROM_ACCOUNT", 500)).toBe(0);
    expect(signedAmount("FROM_INVESTMENT_CASH", 2_000) + cashSigned("TO_ACCOUNT", 2_000)).toBe(0);
  });
});

describe("sale proceeds", () => {
  it("defaults to investment cash, keeps older clients that name an account", () => {
    expect(proceedsChoice({})).toBe("INVESTMENT_CASH");
    expect(proceedsChoice({ accountId: "a" })).toBe("ACCOUNT");
    expect(proceedsChoice({ proceeds: "TRACKING", accountId: "a" })).toBe("TRACKING");
  });

  it("accepts the three choices and nothing else", () => {
    const base = { kind: "OTHER", holdingId: "00000000-0000-4000-8000-000000000000", amount: 100, soldOn: "2026-10-01" };
    for (const p of ["INVESTMENT_CASH", "ACCOUNT", "TRACKING"]) expect(createSaleSchema.safeParse({ ...base, proceeds: p }).success).toBe(true);
    expect(createSaleSchema.safeParse({ ...base, proceeds: "SOMEWHERE" }).success).toBe(false);
  });
});

describe("purchase funding (server)", () => {
  it("splits a total between investment cash and an account", () => {
    expect(serverSplit(7_000, { fromCash: 7_000 })).toEqual({ cash: 7_000, bank: 0, tracked: false });
    expect(serverSplit(12_000, { fromCash: 10_000, paidFromAccountId: "a" })).toEqual({ cash: 10_000, bank: 2_000, tracked: false });
    expect(serverSplit(5_000, { paidFromAccountId: "a" })).toEqual({ cash: 0, bank: 5_000, tracked: false });
    expect(serverSplit(5_000, {})).toEqual({ cash: 0, bank: 0, tracked: true });
  });

  it("refuses a split that doesn't cover the total or overshoots it", () => {
    expect(() => serverSplit(12_000, { fromCash: 10_000 })).toThrow(/Choose an account for the other 2000.00/);
    expect(() => serverSplit(7_000, { fromCash: 8_000 })).toThrow(/more investment cash than the purchase needs/);
  });

  it("folds charges into the price per unit", () => {
    expect(priceWithCharges(10, 700, 20)).toBe(702);
    expect(priceWithCharges(10, 700)).toBe(700);
    expect(priceWithCharges(3, 100, 0)).toBe(100);
  });
});

describe("purchase funding (form)", () => {
  const cash = (amount = "") => ({ ...emptyFunding(), source: "CASH" as const, cash: amount });

  it("uses as much investment cash as covers the total by default", () => {
    expect(fundingSplit(cash(), 7_000, 10_000)).toEqual({ cash: 7_000, rest: 0 });
    expect(fundingSplit(cash(), 12_000, 10_000)).toEqual({ cash: 10_000, rest: 2_000 });
  });

  it("supports using only part of what's available", () => {
    expect(fundingSplit(cash("4000"), 7_000, 10_000)).toEqual({ cash: 4_000, rest: 3_000 });
  });

  it("asks for an account when investment cash falls short, and blocks overdrawing", () => {
    expect(fundingProblem(cash(), 12_000, 10_000, "INR")).toMatch(/Choose an account for the other/);
    expect(fundingProblem({ ...cash(), accountId: "a" }, 12_000, 10_000, "INR")).toBeNull();
    expect(fundingProblem(cash("11000"), 12_000, 10_000, "INR")).toMatch(/Investment cash has/);
    expect(fundingProblem(emptyFunding(), 12_000, 0, "INR")).toBeNull();
  });

  it("sends only what applies", () => {
    expect(fundingBody(emptyFunding(), 7_000, 10_000)).toEqual({});
    expect(fundingBody(cash(), 7_000, 10_000)).toEqual({ fromCash: 7_000 });
    expect(fundingBody({ ...cash(), accountId: "a", categoryId: "c" }, 12_000, 10_000)).toEqual({ fromCash: 10_000, paidFromAccountId: "a", budgetCategoryId: "c" });
    // The account is left out when investment cash covers everything.
    expect(fundingBody({ ...cash(), accountId: "a" }, 7_000, 10_000)).toEqual({ fromCash: 7_000 });
    expect(fundingBody({ ...emptyFunding(), source: "ACCOUNT", accountId: "a" }, 7_000, 10_000)).toEqual({ paidFromAccountId: "a" });
  });
});

describe("request schemas", () => {
  it("takes purchase charges and an idempotency key", () => {
    const r = createStockSchema.safeParse({ ticker: "TCS", quantity: 10, price: 700, charges: 20, currency: "INR", purchaseDate: "2026-10-01", fromCash: 7_020, idempotencyKey: "abcdefgh-1234" });
    expect(r.success).toBe(true);
    expect(createStockSchema.safeParse({ ticker: "TCS", quantity: 10, price: 700, charges: -1, currency: "INR", purchaseDate: "2026-10-01" }).success).toBe(false);
  });

  it("validates cash moves", () => {
    const ok = { direction: "IN", accountId: "00000000-0000-4000-8000-000000000000", amount: 500, date: "2026-10-01" };
    expect(cashMoveSchema.safeParse(ok).success).toBe(true);
    expect(cashMoveSchema.safeParse({ ...ok, amount: 0 }).success).toBe(false);
    expect(cashMoveSchema.safeParse({ ...ok, amount: -5 }).success).toBe(false);
    expect(cashMoveSchema.safeParse({ ...ok, direction: "SIDEWAYS" }).success).toBe(false);
  });
});
