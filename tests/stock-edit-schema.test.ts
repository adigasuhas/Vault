import { describe, expect, it } from "vitest";
import { createStockSchema, patchStockSchema } from "@/lib/schemas";

// Editing a stock offers what adding one does. Purchase fields are edited per
// purchase (lots); how it was paid stays as recorded.
const ADD_TO_EDIT: Record<string, string> = {
  ticker: "ticker",
  exchange: "exchange",
  currency: "currency",
  quantity: "lots.quantity",
  price: "lots.price",
  purchaseDate: "lots.purchaseDate",
};
const FUNDING = ["paidFromAccountId", "budgetCategoryId", "fromSaleId", "paidAmount"];

describe("stock edit schema", () => {
  it("covers every field of the add form", () => {
    const lot = (patchStockSchema.shape.lots.unwrap().element as unknown as { shape: Record<string, unknown> }).shape;
    for (const key of Object.keys(createStockSchema.shape)) {
      if (FUNDING.includes(key)) continue;
      const target = ADD_TO_EDIT[key];
      expect(target, `add field "${key}" has no edit counterpart`).toBeDefined();
      if (target.startsWith("lots.")) expect(lot[target.slice(5)]).toBeDefined();
      else expect(patchStockSchema.shape[target as keyof typeof patchStockSchema.shape]).toBeDefined();
    }
    expect(patchStockSchema.shape.categoryIds).toBeDefined();
    expect(patchStockSchema.shape.newNames).toBeDefined();
  });

  it("validates like the add form", () => {
    const id = "6f1c2a7e-1b2c-4d5e-8f90-123456789abc";
    expect(patchStockSchema.safeParse({ ticker: "  " }).success).toBe(false);
    expect(patchStockSchema.safeParse({ currency: "XYZ" }).success).toBe(false);
    expect(patchStockSchema.safeParse({ lots: [{ id, quantity: 0 }] }).success).toBe(false);
    expect(patchStockSchema.safeParse({ lots: [{ id, price: -1 }] }).success).toBe(false);
    expect(patchStockSchema.safeParse({ lots: [{ id, purchaseDate: "2026-02-30" }] }).success).toBe(false);
    const ok = patchStockSchema.safeParse({ ticker: "infy.ns", exchange: "NSI", currency: "INR", lots: [{ id, quantity: 5, price: 10, purchaseDate: "2026-01-02" }], categoryIds: [id], newNames: ["Tech"] });
    expect(ok.success).toBe(true);
  });
});
