import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  parseOrThrow,
  requirePositive,
  requireFiniteNumber,
  ValidationError,
  toErrorResponse,
  zNumber,
  zPositive,
} from "@/lib/validate";
import { createExpenseSchema, createTransferSchema } from "@/lib/schemas";

describe("numeric guards", () => {
  it("requireFiniteNumber coerces numeric strings and rejects NaN", () => {
    expect(requireFiniteNumber("42", "x")).toBe(42);
    expect(() => requireFiniteNumber("abc", "x")).toThrow(ValidationError);
    expect(() => requireFiniteNumber("", "x")).toThrow(/required/);
  });

  it("requirePositive rejects zero and negatives", () => {
    expect(requirePositive(0.01, "amt")).toBe(0.01);
    expect(() => requirePositive(0, "amt")).toThrow(/greater than zero/);
    expect(() => requirePositive(-1, "amt")).toThrow(/greater than zero/);
  });
});

describe("zod field helpers", () => {
  it("zNumber accepts number or numeric string, rejects junk", () => {
    expect(zNumber.parse("12.5")).toBe(12.5);
    expect(zNumber.parse(7)).toBe(7);
    expect(zNumber.safeParse("nope").success).toBe(false);
    expect(zNumber.safeParse(Infinity).success).toBe(false);
  });

  it("zPositive rejects <= 0", () => {
    expect(zPositive.safeParse(-3).success).toBe(false);
    expect(zPositive.safeParse(0).success).toBe(false);
    expect(zPositive.parse("3")).toBe(3);
  });
});

describe("parseOrThrow", () => {
  const schema = z.object({ a: z.string(), b: zPositive });

  it("returns typed data on success", () => {
    expect(parseOrThrow(schema, { a: "x", b: "5" })).toEqual({ a: "x", b: 5 });
  });

  it("throws a ValidationError with field errors on failure", () => {
    try {
      parseOrThrow(schema, { b: -1 });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      const ve = e as ValidationError;
      expect(ve.fieldErrors).toHaveProperty("a");
      expect(ve.fieldErrors).toHaveProperty("b");
    }
  });
});

describe("toErrorResponse", () => {
  it("maps a ValidationError to a 422", () => {
    const { status, body } = toErrorResponse(new ValidationError("bad", { x: ["nope"] }));
    expect(status).toBe(422);
    expect(body.error).toBe("bad");
    expect(body.fieldErrors).toEqual({ x: ["nope"] });
  });

  it("rethrows a non-ValidationError", () => {
    expect(() => toErrorResponse(new Error("boom"))).toThrow("boom");
  });
});

describe("route schemas", () => {
  it("createExpenseSchema rejects a negative amount and a bad currency", () => {
    expect(createExpenseSchema.safeParse({ accountId: "a", categoryId: "c", amount: -1 }).success).toBe(false);
    expect(
      createExpenseSchema.safeParse({ accountId: "a", categoryId: "c", amount: 10, currency: "XXX" }).success
    ).toBe(false);
  });

  it("createExpenseSchema accepts a minimal valid body and coerces the date", () => {
    const r = createExpenseSchema.parse({ accountId: "a", categoryId: "c", amount: "12.50", date: "2026-08-01" });
    expect(r.amount).toBe(12.5);
    expect(r.date).toBeInstanceOf(Date);
  });

  it("createTransferSchema requires a positive amount", () => {
    expect(createTransferSchema.safeParse({ fromAccountId: "a", toAccountId: "b", amount: 0 }).success).toBe(false);
    expect(createTransferSchema.safeParse({ fromAccountId: "a", toAccountId: "b", amount: 100 }).success).toBe(true);
  });
});
