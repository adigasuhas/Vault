import { z, type ZodType } from "zod";

/**
 * Request-input validation.
 *
 * `parseOrThrow` + the Zod schemas in `src/lib/schemas.ts` are the standard way
 * to validate a route body. The `requirePositive` / `requireFiniteNumber`
 * helpers below predate that and are kept for the money-movement guards that
 * are also enforced inside `ledger.ts`.
 */

export class ValidationError extends Error {
  /** Field-keyed messages, when available. */
  fieldErrors?: Record<string, string[]>;
  constructor(message: string, fieldErrors?: Record<string, string[]>) {
    super(message);
    this.name = "ValidationError";
    this.fieldErrors = fieldErrors;
  }
}

/** Validates `data` against `schema`, throwing a ValidationError (→ 422) on failure. */
export function parseOrThrow<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data;

  const fieldErrors: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "_";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  const first = result.error.issues[0];
  const label = first?.path.length ? `${first.path.join(".")}: ` : "";
  throw new ValidationError(`${label}${first?.message ?? "Invalid input."}`, fieldErrors);
}

/** Reads and validates a JSON request body in one step. */
export async function parseJson<T>(req: Request, schema: ZodType<T>): Promise<T> {
  const body = await req.json().catch(() => {
    throw new ValidationError("Request body must be valid JSON.");
  });
  return parseOrThrow(schema, body);
}

// ---- legacy numeric guards (still used by ledger.ts and a few routes) ----

export function requireFiniteNumber(value: unknown, field: string): number {
  if (value === "" || value === null || value === undefined) {
    throw new ValidationError(`${field} is required.`);
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw new ValidationError(`${field} must be a valid number.`);
  }
  return n;
}

export function requirePositive(value: unknown, field: string): number {
  const n = requireFiniteNumber(value, field);
  if (n <= 0) throw new ValidationError(`${field} must be greater than zero.`);
  if (n > MAX_AMOUNT) throw new ValidationError(`${field} is too large.`);
  return n;
}

export function requireNonNegative(value: unknown, field: string): number {
  const n = requireFiniteNumber(value, field);
  if (n < 0) throw new ValidationError(`${field} cannot be negative.`);
  return n;
}

export function assertSameCurrency(a: string, b: string, message: string): void {
  if (a !== b) throw new ValidationError(message);
}

/** Maps a thrown ValidationError to a Response payload; rethrows anything else. */
export function toErrorResponse(err: unknown): {
  body: { error: string; fieldErrors?: Record<string, string[]> };
  status: number;
} {
  if (err instanceof ValidationError) {
    return {
      body: { error: err.message, ...(err.fieldErrors ? { fieldErrors: err.fieldErrors } : {}) },
      status: 422,
    };
  }
  throw err;
}

// ---- money ----

/** Largest amount any single money field accepts (100 billion in the field's
 * currency). Keeps every value and every sum of values well inside the range
 * where a float holds exact paise/cents (2^53 ≈ 9e15), so running balances
 * can't drift. */
export const MAX_AMOUNT = 100_000_000_000;

/** Rounds to 2 decimal places (half away from zero; EPSILON fixes 1.005-style
 * representation errors). */
export function roundMoney(n: number): number {
  return Math.sign(n) * Math.round((Math.abs(n) + Number.EPSILON) * 100) / 100;
}

/** Sums money values exactly by adding in integer cents. */
export function sumMoney(values: Iterable<number>): number {
  let cents = 0;
  for (const v of values) cents += Math.round(v * 100);
  return cents / 100;
}

/** Calendar date from a query string, or null when absent. Throws a
 * ValidationError (→ 422) for a value that isn't a real date, instead of
 * letting `Invalid Date` reach the database driver. */
export function queryDate(params: URLSearchParams, name: string): Date | null {
  const raw = params.get(name);
  if (raw === null || raw.trim() === "") return null;
  if (!isRealDate(raw.trim())) throw new ValidationError(`'${name}' must be a valid date (YYYY-MM-DD).`);
  return new Date(raw.trim());
}

/** True for parseable dates whose Y-M-D part (when given as ISO) exists on
 * the calendar, so "2026-02-31" and "99999-99-99" are rejected rather than
 * silently rolled over. */
function isRealDate(s: string): boolean {
  const t = Date.parse(s);
  if (Number.isNaN(t)) return false;
  const year = new Date(t).getUTCFullYear();
  if (year < 1900 || year > 2200) return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return true;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

// ---- shared field schemas ----

/** Accepts a number or a numeric string; rejects NaN / Infinity. */
export const zNumber = z.preprocess(
  (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v),
  z.number({ error: "must be a number" }).finite("must be a finite number")
);

const TOO_LARGE = `must be at most ${MAX_AMOUNT.toLocaleString("en-US")}`;
const hasAtMost = (n: number, places: number) => Math.abs(n * 10 ** places - Math.round(n * 10 ** places)) < 1e-6;

/** Positive quantity, price, NAV or unit count: bounded, up to 6 decimals. */
export const zPositive = zNumber
  .refine((n) => n > 0, "must be greater than zero")
  .refine((n) => n <= MAX_AMOUNT, TOO_LARGE)
  .refine((n) => hasAtMost(n, 6), "has too many decimal places");
export const zNonNegative = zNumber
  .refine((n) => n >= 0, "cannot be negative")
  .refine((n) => n <= MAX_AMOUNT, TOO_LARGE)
  .refine((n) => hasAtMost(n, 6), "has too many decimal places");

/** A money amount that posts to the ledger: > 0, ≤ MAX_AMOUNT, at most 2 decimals. */
export const zMoney = zNumber
  .refine((n) => n > 0, "must be greater than zero")
  .refine((n) => n <= MAX_AMOUNT, TOO_LARGE)
  .refine((n) => hasAtMost(n, 2), "can have at most 2 decimal places")
  .transform(roundMoney);
export const zMoneyNonNegative = zNumber
  .refine((n) => n >= 0, "cannot be negative")
  .refine((n) => n <= MAX_AMOUNT, TOO_LARGE)
  .refine((n) => hasAtMost(n, 2), "can have at most 2 decimal places")
  .transform(roundMoney);
/** Signed money (opening balances: a card can open owing money). */
export const zSignedMoney = zNumber
  .refine((n) => Math.abs(n) <= MAX_AMOUNT, TOO_LARGE)
  .refine((n) => hasAtMost(n, 2), "can have at most 2 decimal places")
  .transform(roundMoney);
export const zInt = zNumber.refine((n) => Number.isInteger(n), "must be a whole number");
export const zId = z.string().min(1, "is required");
export const zIsoDate = z
  .string()
  .refine((s) => isRealDate(s.trim()), "must be a valid date")
  .transform((s) => new Date(s.trim()));
