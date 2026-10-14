import { describe, expect, it } from "vitest";
import { buildSummary, period } from "@/lib/research/yahoo";
import { growth } from "@/lib/research/metrics";

// Shapes as returned live by Yahoo (Oct 2026), trimmed.
const infy = {
  price: { regularMarketPrice: 1088, regularMarketChange: 25.9, regularMarketChangePercent: 0.0244, currency: "INR", longName: "Infosys Limited", exchangeName: "NSI", marketState: "POSTPOST", regularMarketTime: "2026-10-14T09:59:54.000Z", marketCap: 4406773809152 },
  summaryDetail: { previousClose: 1062.1, trailingPE: 14.82, dividendYield: 0.0471, payoutRatio: 0.6778, currency: "INR", priceToSalesTrailing12Months: 12.3 },
  financialData: { financialCurrency: "USD", totalCash: 3124000000, debtToEquity: 9.541, returnOnEquity: 0.32 },
  defaultKeyStatistics: { enterpriseValue: 4298982817792, enterpriseToEbitda: 959.17, priceToBook: 4.78 },
};
const aapl = {
  price: { regularMarketPrice: 341.27, currency: "USD", longName: "Apple Inc.", marketState: "PRE" },
  summaryDetail: { trailingPE: 40.1, currency: "USD", priceToSalesTrailing12Months: 9.1 },
  financialData: { financialCurrency: "USD" },
  defaultKeyStatistics: { enterpriseToEbitda: 28.3 },
};
const item = (s: ReturnType<typeof buildSummary>, label: string) => s.groups.flatMap((g) => g.items).find((i) => i.label === label);

describe("research summary", () => {
  it("drops ratios that would mix trading and reporting currencies, and says why", () => {
    const s = buildSummary("INFY.NS", infy, { exchangeDataDelayedBy: 15, quoteSourceName: "Delayed Quote" });
    expect(s.reportingCurrency).toBe("USD");
    expect(item(s, "EV/EBITDA")).toBeUndefined();
    expect(item(s, "Price/sales")).toBeUndefined();
    expect(s.notes[0]).toMatch(/trades in INR but reports its accounts in USD/);
    // Each amount keeps its own currency.
    expect(item(s, "Market cap")).toMatchObject({ value: 4406773809152, currency: "INR" });
    expect(item(s, "Total cash")).toMatchObject({ value: 3124000000, currency: "USD" });
  });
  it("keeps them when the currencies match", () => {
    const s = buildSummary("AAPL", aapl, null);
    expect(item(s, "EV/EBITDA")?.value).toBe(28.3);
    expect(s.notes).toEqual([]);
  });
  it("converts provider units and leaves missing values null, never 0", () => {
    const s = buildSummary("INFY.NS", infy, { exchangeDataDelayedBy: 15 });
    expect(s.quote.changePct).toBeCloseTo(2.44);
    expect(s.quote.delayMinutes).toBe(15);
    expect(item(s, "Debt / equity")?.value).toBeCloseTo(0.0954);
    expect(item(s, "Gross margin")?.value).toBeNull();
    expect(item(s, "Beta")?.value).toBeNull();
  });
});

describe("statement periods", () => {
  it("maps rows and works out free cash flow only from real figures", () => {
    const p = period({ date: "2026-06-30T00:00:00.000Z", totalRevenue: 100, netIncome: 20, operatingCashFlow: 30, capitalExpenditure: -12 });
    expect(p).toMatchObject({ date: "2026-06-30", revenue: 100, netIncome: 20, freeCashFlow: 18, totalAssets: null });
    expect(period({ date: "2026-06-30T00:00:00.000Z", totalRevenue: 100 }).freeCashFlow).toBeNull();
  });
});

describe("growth", () => {
  it("needs both values and a positive base", () => {
    expect(growth(120, 100)).toBeCloseTo(20);
    expect(growth(80, 100)).toBeCloseTo(-20);
    expect(growth(100, null)).toBeNull();
    expect(growth(null, 100)).toBeNull();
    expect(growth(10, -5)).toBeNull();
    expect(growth(10, 0)).toBeNull();
  });
});
