import { describe, expect, it } from "vitest";
import { heldOn, priceOn } from "@/lib/investment-reports";
import { reportToCsv, type Report } from "@/lib/reports";

describe("priceOn", () => {
  const s = [{ d: "2026-01-05", v: 100 }, { d: "2026-01-09", v: 110 }, { d: "2026-01-15", v: 120 }];
  it("uses the last close on or before the date", () => {
    expect(priceOn(s, "2026-01-09")).toBe(110);
    expect(priceOn(s, "2026-01-12")).toBe(110);
    expect(priceOn(s, "2026-02-01")).toBe(120);
  });
  it("is unknown (null, not zero) before the history starts", () => {
    expect(priceOn(s, "2026-01-04")).toBeNull();
    expect(priceOn([], "2026-01-10")).toBeNull();
  });
});

describe("heldOn", () => {
  // Bought 100 on 1 Jan (A) and 50 on 1 Mar (B); 30 of A sold on 1 Feb, all of B sold 1 Apr.
  const current = [{ id: "A", qty: 70, date: "2026-01-01" }];
  const sold = [
    { lotId: "A", qty: 30, bought: "2026-01-01", soldOn: "2026-02-01" },
    { lotId: "B", qty: 50, bought: "2026-03-01", soldOn: "2026-04-01" },
  ];
  const all = () => true;
  it("counts what was held at each date", () => {
    expect(heldOn("2025-12-31", current, sold, all)).toBe(0);
    expect(heldOn("2026-01-15", current, sold, all)).toBe(100);
    expect(heldOn("2026-02-15", current, sold, all)).toBe(70);
    expect(heldOn("2026-03-15", current, sold, all)).toBe(120);
    expect(heldOn("2026-04-15", current, sold, all)).toBe(70);
  });
  it("only counts the purchases in a category", () => {
    expect(heldOn("2026-03-15", current, sold, (l) => l === "B")).toBe(50);
    expect(heldOn("2026-03-15", current, sold, (l) => l === "A")).toBe(70);
  });
});

describe("CSV", () => {
  const r: Report = {
    type: "portfolio",
    title: "t",
    subtitle: "s",
    currency: "INR",
    columns: [
      { key: "name", label: "Instrument", kind: "text" },
      { key: "qty", label: "Quantity", kind: "number" },
      { key: "price", label: "Price", kind: "money", currencyKey: "currency", decimals: 4 },
      { key: "value", label: "Value", kind: "money", currencyKey: "currency" },
      { key: "ret", label: "Return", kind: "pct" },
      { key: "currency", label: "Currency", kind: "text" },
    ],
    rows: [
      { name: 'Tata "Steel", Ltd', qty: 412.338123, price: 1471.428571, value: 1234567.891, ret: -3.14159, currency: "INR" },
      { name: "No price\nyet", qty: 1, price: null, value: 100, ret: null, currency: "GBP" },
    ],
    summary: [],
  };
  const lines = reportToCsv(r).replace(/^﻿/, "").trim().split("\n");
  it("has one header and one line per row", () => {
    expect(lines[0]).toBe("Instrument,Quantity,Price,Value,Return,Currency");
  });
  it("writes raw numbers with no symbols, to sensible precision", () => {
    expect(lines[1]).toBe('"Tata ""Steel"", Ltd",412.338123,1471.4286,1234567.89,-3.14,INR');
  });
  it("leaves unknown values blank (never 0) and quotes line breaks", () => {
    expect(reportToCsv(r)).toContain('"No price\nyet",1,,100,,GBP');
  });
});
