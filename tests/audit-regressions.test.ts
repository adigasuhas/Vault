import { describe, it, expect, afterEach, vi } from "vitest";
import {
  parseOrThrow,
  queryDate,
  roundMoney,
  sumMoney,
  ValidationError,
  MAX_AMOUNT,
  zIsoDate,
} from "@/lib/validate";
import { createExpenseSchema, createTransferSchema, createAccountSchema, patchLotSchema } from "@/lib/schemas";
import { assertPostable } from "@/lib/ledger";
import { amortizationSchedule } from "@/lib/loans";
import { clientIp } from "@/lib/rate-limit";

/** Regression tests for VAULT_PRODUCTION_READINESS_REPORT.md (2026-10-07). */

const expense = (over: Record<string, unknown>) => ({ accountId: "a", categoryId: "c", amount: 250, ...over });

describe("FIN-002: money magnitude and precision", () => {
  it("rejects amounts above MAX_AMOUNT, including 1e21", () => {
    expect(() => parseOrThrow(createExpenseSchema, expense({ amount: 1e21 }))).toThrow(ValidationError);
    expect(() => parseOrThrow(createExpenseSchema, expense({ amount: MAX_AMOUNT + 1 }))).toThrow(/at most/);
    expect(parseOrThrow(createExpenseSchema, expense({ amount: MAX_AMOUNT })).amount).toBe(MAX_AMOUNT);
  });

  it("rejects more than 2 decimal places but normalises float noise", () => {
    expect(() => parseOrThrow(createExpenseSchema, expense({ amount: 10.123 }))).toThrow(/2 decimal/);
    expect(parseOrThrow(createExpenseSchema, expense({ amount: 0.1 + 0.2 })).amount).toBe(0.3);
    expect(parseOrThrow(createTransferSchema, { fromAccountId: "a", toAccountId: "b", amount: "1234.50" }).amount).toBe(1234.5);
  });

  it("bounds signed opening balances", () => {
    expect(parseOrThrow(createAccountSchema, { name: "Card", currency: "INR", accountType: "CREDIT_CARD", openingBalance: -5000.5 }).openingBalance).toBe(-5000.5);
    expect(() => parseOrThrow(createAccountSchema, { name: "X", currency: "INR", accountType: "SAVINGS", openingBalance: -1e20 })).toThrow(ValidationError);
  });

  it("ledger guard refuses out-of-range or sub-cent postings", () => {
    expect(() => assertPostable(1e18, "INR", "INR")).toThrow(/more than/);
    expect(() => assertPostable(1.001, "INR", "INR")).toThrow(/2 decimal/);
    expect(() => assertPostable(99.99, "INR", "INR")).not.toThrow();
  });

  it("sums in cents without drift", () => {
    const values = Array.from({ length: 1000 }, () => 0.1);
    expect(sumMoney(values)).toBe(100);
    expect(sumMoney([MAX_AMOUNT, -MAX_AMOUNT, 82400])).toBe(82400);
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(-1.005)).toBe(-1.01);
  });
});

describe("SEC-002: receiptUrl scheme", () => {
  it.each(["javascript:alert(document.domain)", "data:text/html,<script>alert(1)</script>", "vbscript:msgbox(1)"])("rejects %s", (url) => {
    expect(() => parseOrThrow(createExpenseSchema, expense({ receiptUrl: url }))).toThrow(ValidationError);
  });
  it("accepts http(s) links", () => {
    expect(parseOrThrow(createExpenseSchema, expense({ receiptUrl: "https://example.com/r.pdf" })).receiptUrl).toBe("https://example.com/r.pdf");
  });
});

describe("BUG-001 / BUG-002: invalid dates are 422s, not 500s", () => {
  it("queryDate rejects malformed and impossible dates", () => {
    for (const bad of ["invalid", "not-a-date", "2026-99-99", "2026-02-31", "99999-99-99"]) {
      expect(() => queryDate(new URLSearchParams({ from: bad }), "from")).toThrow(ValidationError);
    }
    expect(queryDate(new URLSearchParams({ from: "2026-02-28" }), "from")?.toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(queryDate(new URLSearchParams(), "from")).toBeNull();
  });

  it("zIsoDate (stock lot purchaseDate) rejects invalid dates", () => {
    expect(() => parseOrThrow(patchLotSchema, { purchaseDate: "invalid-date" })).toThrow(ValidationError);
    expect(zIsoDate.safeParse("2024-02-29").success).toBe(true);
    expect(zIsoDate.safeParse("2023-02-29").success).toBe(false);
  });
});

describe("FIN-003: EMI schedule is penny-exact", () => {
  it("rounds every row to 2 decimals and repays exactly the principal", () => {
    const rows = amortizationSchedule(100_000, 12, 12, new Date("2026-01-01"));
    expect(rows[0].emi).toBe(8884.88);
    for (const r of rows) {
      for (const v of [r.emi, r.interest, r.principal, r.balanceAfter]) expect(roundMoney(v)).toBe(v);
    }
    expect(sumMoney(rows.map((r) => r.principal))).toBe(100_000);
    expect(rows[rows.length - 1].balanceAfter).toBe(0);
  });
});

describe("SEC-001: client IP can't be spoofed", () => {
  const req = (headers: Record<string, string>) => new Request("http://x/api/auth/login", { headers });
  afterEach(() => vi.unstubAllEnvs());

  it("ignores X-Forwarded-For when no proxy is trusted", () => {
    vi.stubEnv("TRUST_PROXY", "none");
    vi.stubEnv("VERCEL", "");
    expect(clientIp(req({ "x-forwarded-for": "198.51.100.99" }))).toBe("unknown");
    expect(clientIp(req({ "x-real-ip": "198.51.100.99" }))).toBe("unknown");
  });

  it("with N trusted proxies, takes the N-th entry from the right", () => {
    vi.stubEnv("TRUST_PROXY", "1");
    // The client forged the first entry; nginx appended the real address.
    expect(clientIp(req({ "x-forwarded-for": "198.51.100.99, 203.0.113.7" }))).toBe("203.0.113.7");
    vi.stubEnv("TRUST_PROXY", "2");
    expect(clientIp(req({ "x-forwarded-for": "6.6.6.6, 203.0.113.7, 10.0.0.2" }))).toBe("203.0.113.7");
  });

  it("uses the platform header on Vercel / Cloudflare", () => {
    vi.stubEnv("TRUST_PROXY", "");
    vi.stubEnv("VERCEL", "1");
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.7" }))).toBe("203.0.113.7");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("TRUST_PROXY", "cloudflare");
    expect(clientIp(req({ "cf-connecting-ip": "203.0.113.8", "x-forwarded-for": "1.1.1.1" }))).toBe("203.0.113.8");
  });

  it("rejects junk in a trusted header", () => {
    vi.stubEnv("TRUST_PROXY", "cloudflare");
    expect(clientIp(req({ "cf-connecting-ip": "<script>" }))).toBe("unknown");
  });
});
