import { describe, expect, it } from "vitest";
import { notebookTotals, possibleDuplicates, type EntryLike } from "@/lib/notebook-checks";

const e = (id: string, over: Partial<EntryLike> = {}): EntryLike => ({ id, title: "Flights", amount: "1000", currency: "INR", date: "2026-10-01T00:00:00.000Z", paidBy: "ME", status: "OPEN", createdAt: `2026-10-0${id.length}T00:00:00Z`, ...over });

describe("notebook totals", () => {
  it("counts an entry on exactly one side, and the sides add up to the open total", () => {
    const t = notebookTotals([e("a"), e("bb", { paidBy: "OTHER", amount: "250" }), e("ccc", { currency: "GBP", amount: "10" })]);
    expect(t.open).toEqual({ INR: 1250, GBP: 10 });
    expect(t.byMe).toEqual({ INR: 1000, GBP: 10 });
    expect(t.byOthers).toEqual({ INR: 250 });
  });

  it("changing the payer moves the amount instead of adding it", () => {
    const before = notebookTotals([e("a")]);
    const after = notebookTotals([e("a", { paidBy: "OTHER" })]);
    expect(before).toEqual({ open: { INR: 1000 }, byMe: { INR: 1000 }, byOthers: {} });
    expect(after).toEqual({ open: { INR: 1000 }, byMe: {}, byOthers: { INR: 1000 } });
  });

  it("leaves converted entries out", () => {
    expect(notebookTotals([e("a", { status: "CONVERTED" })]).open).toEqual({});
  });
});

describe("possible duplicates", () => {
  it("flags the same thing written twice, whoever paid", () => {
    expect(possibleDuplicates([e("a"), e("bb", { paidBy: "OTHER", title: "  flights " }), e("ccc", { title: "Taxi" })])).toEqual([["a", "bb"]]);
  });
  it("ignores different amounts, dates, currencies and converted entries", () => {
    expect(possibleDuplicates([e("a"), e("bb", { amount: "999" })])).toEqual([]);
    expect(possibleDuplicates([e("a"), e("bb", { date: "2026-10-02" })])).toEqual([]);
    expect(possibleDuplicates([e("a"), e("bb", { currency: "GBP" })])).toEqual([]);
    expect(possibleDuplicates([e("a"), e("bb", { status: "CONVERTED" })])).toEqual([]);
  });
  it("treats 1000 and 1000.00 as the same amount", () => {
    expect(possibleDuplicates([e("a", { amount: "1000" }), e("bb", { amount: "1000.00" })])).toHaveLength(1);
  });
});
