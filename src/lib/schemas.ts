import { z } from "zod";
import { zPositive, zNonNegative, zInt, zId, zIsoDate, zMoney, zMoneyNonNegative, zSignedMoney } from "@/lib/validate";
import { SUPPORTED_CURRENCIES } from "@/lib/currencies";

const CURRENCY = z.enum(SUPPORTED_CURRENCIES.map((c) => c.code) as [string, ...string[]]);
const ACCOUNT_TYPE = z.enum([
  "SAVINGS",
  "CURRENT",
  "FIXED_DEPOSIT",
  "CREDIT_CARD",
  "CASH_WALLET",
  "DIGITAL_WALLET",
  "LOAN",
  "PREPAID_CARD",
  "FOREX_CARD",
]);
const FREQUENCY = z.enum([
  "ONE_TIME",
  "WEEKLY",
  "MONTHLY",
  "QUARTERLY",
  "HALF_YEARLY",
  "YEARLY",
  "CUSTOM",
]);
const OTHER_ASSET_TYPE = z.enum(["GOLD", "BOND", "CRYPTO", "REAL_ESTATE", "OTHER"]);
const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "must be YYYY-MM");

const optionalTrimmed = z.string().trim().max(500).optional().or(z.literal("").transform(() => undefined));

// ---- Accounts ----
export const createAccountSchema = z.object({
  name: z.string().trim().min(1, "is required").max(120),
  bankName: optionalTrimmed,
  branchName: optionalTrimmed,
  accountNumber: z.string().trim().max(40).optional(),
  currency: CURRENCY,
  accountType: ACCOUNT_TYPE,
  openingBalance: zSignedMoney.optional().default(0),
  openingDate: zIsoDate.optional(),
  creditLimit: zMoneyNonNegative.optional().nullable(),
  notes: optionalTrimmed,
});

export const patchAccountSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  bankName: z.string().trim().max(500).nullish(),
  branchName: z.string().trim().max(500).nullish(),
  accountNumber: z.string().trim().max(40).nullish(),
  notes: z.string().trim().max(500).nullish(),
  // Closing goes through POST /api/accounts/:id/close (balance handling).
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
  creditLimit: zMoneyNonNegative.nullish(),
  openingBalance: zSignedMoney.optional(),
  openingBalanceReason: z.string().trim().max(300).optional(),
});

// ---- Expenses ----
export const createExpenseSchema = z.object({
  // Optional for one-time purchases only (checked in the route).
  accountId: zId.nullish(),
  categoryId: zId,
  amount: zMoney,
  currency: CURRENCY.optional(),
  date: zIsoDate.optional(),
  description: optionalTrimmed,
  notes: optionalTrimmed,
  // Only web links: a `javascript:`/`data:` URL would run script if it were
  // ever rendered as a link.
  receiptUrl: z
    .string()
    .trim()
    .max(1000)
    .url()
    .refine((u) => /^https?:\/\//i.test(u), "must start with http:// or https://")
    .optional(),
  idempotencyKey: z.string().max(80).optional(),
  oneTime: z.boolean().optional(),
  countInBudget: z.boolean().optional(),
  projectId: zId.nullish(),
});

export const amendExpenseSchema = z.object({
  accountId: zId.nullish(),
  currency: CURRENCY.optional(),
  categoryId: zId.optional(),
  amount: zMoney.optional(),
  date: zIsoDate.optional(),
  description: z.string().trim().max(500).nullish(),
  notes: z.string().trim().max(2000).nullish(),
  oneTime: z.boolean().optional(),
  countInBudget: z.boolean().optional(),
  projectId: zId.nullish(),
});

export const expenseProjectSchema = z.object({
  name: z.string().trim().min(1, "Give the group a name.").max(80),
  notes: z.string().trim().max(500).nullish(),
});

export const updateExpenseProjectSchema = expenseProjectSchema.partial().extend({ archived: z.boolean().optional() });

// ---- Notebook ----
const notebookFields = {
  title: z.string().trim().min(1, "Say what it was.").max(160),
  amount: zMoney,
  currency: CURRENCY,
  date: zIsoDate,
  paidBy: z.enum(["ME", "OTHER"]),
  person: z.string().trim().max(120).nullish(),
  notes: z.string().trim().max(500).nullish(),
  projectId: zId.nullish(),
};
export const notebookEntrySchema = z.object(notebookFields);
export const patchNotebookEntrySchema = z.object(notebookFields).partial();
export const convertNotebookEntrySchema = z.discriminatedUnion("to", [
  z.object({ to: z.literal("EXPENSE"), accountId: zId, categoryId: zId, date: zIsoDate.optional() }),
  z.object({ to: z.literal("RECEIVABLE"), accountId: zId, date: zIsoDate }),
]);

export const closeAccountSchema = z
  .object({
    transferToAccountId: zId.optional(),
    writeOff: z.boolean().optional(),
    // Typed by the user — must equal the account's name when writing off.
    confirmName: z.string().trim().max(120).optional(),
    note: z.string().trim().max(300).optional(),
  });

// ---- Transfers ----
export const createTransferSchema = z.object({
  fromAccountId: zId,
  toAccountId: zId,
  amount: zMoney,
  toAmount: zMoney.optional(),
  date: zIsoDate.optional(),
  notes: optionalTrimmed,
  idempotencyKey: z.string().max(80).optional(),
  confirmDuplicate: z.boolean().optional(),
});

export const reverseSchema = z.object({ reason: z.string().trim().max(300).optional() });

// ---- Schedules (receivables + scheduled payments) ----
const KIND = z.enum([
  "SALARY", "STIPEND", "REFUND", "POCKET_MONEY", "OTHER_INCOME",
  "RENT", "EMI", "SUBSCRIPTION", "INSURANCE", "FEES", "UTILITIES", "OTHER_PAYMENT",
]);
const overrideItem = z.object({
  occurrenceDate: zIsoDate,
  date: zIsoDate.nullish(),
  amount: zMoney.nullish(),
});
export const createScheduleSchema = z
  .object({
    direction: z.enum(["INCOME", "PAYMENT"]),
    kind: KIND,
    name: z.string().trim().min(1, "is required").max(120),
    amount: zMoney,
    /** Defaults to the account's currency. */
    currency: CURRENCY.optional(),
    /** Optional for payments: decided per month on the budget, or when paid. */
    accountId: zId.nullish(),
    categoryId: zId.nullish(),
    frequency: FREQUENCY,
    customIntervalDays: zInt.refine((n) => n >= 1 && n <= 3650, "out of range").nullish(),
    startDate: zIsoDate,
    endDate: zIsoDate.nullish(),
    requiresConfirmation: z.boolean().default(true),
    notes: z.string().trim().max(500).nullish(),
    overrides: z.array(overrideItem).max(60).optional(),
  })
  .refine((v) => v.frequency !== "CUSTOM" || v.customIntervalDays != null, {
    message: "Custom interval (1–3650 days) is required for a custom frequency.",
    path: ["customIntervalDays"],
  });
export const patchScheduleSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  kind: KIND.optional(),
  amount: zMoney.optional(),
  currency: CURRENCY.optional(),
  accountId: zId.nullish(),
  categoryId: zId.nullish(),
  requiresConfirmation: z.boolean().optional(),
  endDate: zIsoDate.nullish(),
  notes: z.string().trim().max(500).nullish(),
  isActive: z.boolean().optional(),
  frequency: FREQUENCY.optional(),
  customIntervalDays: zInt.refine((n) => n >= 1 && n <= 3650, "out of range").nullish(),
  startDate: zIsoDate.optional(),
});
export const overrideSchema = overrideItem;
export const skipAheadSchema = z.object({ occurrenceDate: zIsoDate, note: z.string().trim().max(300).optional() });
export const confirmOccurrenceSchema = z.object({
  amount: zMoney.optional(),
  date: zIsoDate.optional(),
  accountId: zId.optional(),
});
export const noteSchema = z.object({ note: z.string().trim().max(300).optional(), reason: z.string().trim().max(300).optional() });

// ---- Budget ----
export const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(80),
  month: MONTH.optional(),
  isDefault: z.boolean().optional(),
});
/** One workflow: pick (or name) a category, the account/card it's paid from,
 * the amount, and whether it repeats every month from this one onward. */
export const addAllocationSchema = z
  .object({
    month: MONTH,
    categoryId: zId.optional(),
    newCategoryName: z.string().trim().min(1).max(80).optional(),
    budgetAmount: zMoneyNonNegative.default(0),
    accountId: zId.nullish(),
    recurring: z.boolean().default(false),
  })
  .refine((v) => v.categoryId || v.newCategoryName, { message: "Choose a category or name a new one.", path: ["categoryId"] });
export const patchAllocationSchema = z.object({
  budgetAmount: zMoneyNonNegative.optional(),
  accountId: zId.nullish(),
  /** MONTH = this month only; FORWARD = this and every later month (also
   * updates the recurring default). */
  scope: z.enum(["MONTH", "FORWARD"]).default("MONTH"),
  note: z.string().trim().max(300).optional(),
});
export const deleteAllocationSchema = z.object({ scope: z.enum(["MONTH", "FORWARD"]).default("MONTH") });
export const patchCategorySchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  isDefault: z.boolean().optional(),
});
export const reorderCategoriesSchema = z.object({ order: z.array(zId).min(1) });
export const setBudgetIncomeSchema = z.object({ month: MONTH.optional(), totalIncome: zMoneyNonNegative.optional() });
export const unallocatedSchema = z.object({
  month: MONTH.optional(),
  amount: zMoney,
  accountId: zId.optional(),
  addToSavings: z.boolean().optional(),
});

// ---- Investments ----
/** How an investment purchase was paid for (see lib/investment-funding). */
const fundingFields = {
  paidFromAccountId: zId.optional(),
  budgetCategoryId: zId.optional(),
  fromSaleId: zId.optional(),
  paidAmount: zMoney.optional(),
};
export const createStockSchema = z.object({
  ticker: z.string().trim().min(1).max(30),
  exchange: z.string().trim().max(10).optional(),
  quantity: zPositive,
  price: zPositive,
  currency: CURRENCY,
  purchaseDate: zIsoDate,
  ...fundingFields,
});
export const patchLotSchema = z.object({
  quantity: zPositive.optional(),
  price: zPositive.optional(),
  purchaseDate: zIsoDate.optional(),
});
/** Everything editable on a stock (see lib/stock-edit). quantity and
 * avgBuyPrice are the older single-purchase shorthand. */
export const patchStockSchema = z.object({
  ticker: z.string().trim().min(1).max(30).optional(),
  exchange: z.string().trim().max(10).nullish(),
  currency: CURRENCY.optional(),
  lots: z.array(patchLotSchema.extend({ id: zId })).max(500).optional(),
  categoryIds: z.array(zId).max(50).optional(),
  newNames: z.array(z.string().max(80)).max(20).optional(),
  quantity: zPositive.optional(),
  avgBuyPrice: zPositive.optional(),
});
export const createFundSchema = z.object({
  fundName: z.string().trim().min(1).max(160),
  schemeCode: z.string().trim().max(20).optional(),
  units: zPositive,
  avgNav: zPositive,
  currency: CURRENCY,
  purchaseDate: zIsoDate,
  ...fundingFields,
});
export const patchFundSchema = z.object({
  units: zPositive.optional(),
  avgNav: zPositive.optional(),
  schemeCode: z.string().trim().max(20).nullish(),
});
export const createDepositSchema = z.object({
  bank: z.string().trim().min(1).max(120),
  principal: zMoney,
  interestRate: zNonNegative.refine((n) => n <= 100, "must be at most 100%"),
  startDate: zIsoDate,
  maturityDate: zIsoDate,
  currency: CURRENCY,
  linkedAccountId: zId.optional(),
  ...fundingFields,
});
export const createOtherAssetSchema = z.object({
  assetType: OTHER_ASSET_TYPE,
  name: z.string().trim().min(1).max(120),
  quantity: zNonNegative.optional(),
  unit: z.string().trim().max(20).optional(),
  purchasePrice: zMoney,
  currentValue: zMoneyNonNegative,
  currency: CURRENCY,
  purchaseDate: zIsoDate,
  notes: optionalTrimmed,
  ...fundingFields,
});
export const patchOtherAssetSchema = z.object({
  currentValue: zMoneyNonNegative.optional(),
  notes: z.string().trim().max(500).nullish(),
});

// ---- Loans ----
export const createLoanSchema = z.object({
  name: z.string().trim().min(1).max(120),
  principal: zMoney,
  interestRate: zNonNegative.refine((n) => n <= 100, "must be at most 100%"),
  installments: zInt.refine((n) => n >= 1 && n <= 600, "out of range"),
  currency: CURRENCY,
  startDate: zIsoDate,
  /** The user's own EMI. Omitted: computed (an equal split at 0%). */
  emiAmount: zMoney.optional(),
  linkedAccountId: zId.optional(),
  /** The Notebook entry this loan was made from (marked converted). */
  notebookEntryId: zId.optional(),
  /** Create the EMI schedule (paid from linkedAccountId) right away. */
  scheduleEmis: z.boolean().optional(),
  requiresConfirmation: z.boolean().optional(),
});
export const loanScheduleSchema = z.object({
  accountId: zId,
  requiresConfirmation: z.boolean().default(true),
});
export const patchLoanSchema = z.object({
  status: z.enum(["ACTIVE", "CLOSED"]).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  linkedAccountId: zId.optional(),
  // Terms: only while nothing has been paid or skipped yet.
  principal: zMoney.optional(),
  interestRate: zNonNegative.refine((n) => n <= 100, "must be at most 100%").optional(),
  installments: zInt.refine((n) => n >= 1 && n <= 600, "out of range").optional(),
  startDate: zIsoDate.optional(),
  /** null: back to the computed EMI. */
  emiAmount: zMoney.nullish(),
});

// ---- Investment sales ----
const saleCommon = {
  holdingId: zId,
  charges: zMoneyNonNegative.default(0),
  soldOn: zIsoDate,
  // Omitted: the proceeds are kept for reinvestment rather than credited.
  accountId: zId.optional(),
  // Only when the account's currency differs from the holding's: what arrived.
  creditedAmount: zMoney.optional(),
  note: z.string().trim().max(500).optional(),
};
export const createSaleSchema = z.discriminatedUnion("kind", [
  // Shares or fund units, at a price (or NAV) per unit.
  z.object({ kind: z.literal("STOCK"), quantity: zPositive, price: zNonNegative, ...saleCommon }),
  z.object({ kind: z.literal("MUTUAL_FUND"), quantity: zPositive, price: zNonNegative, ...saleCommon }),
  // A whole deposit or asset, for one amount (before charges).
  z.object({ kind: z.literal("FIXED_DEPOSIT"), amount: zMoney, ...saleCommon }),
  z.object({ kind: z.literal("OTHER"), amount: zMoney, ...saleCommon }),
]);
export type CreateSaleInput = z.infer<typeof createSaleSchema>;
export const reinvestSchema = z.object({ amount: zMoney, into: z.string().trim().min(1, "Say what it went into.").max(160), date: zIsoDate, note: z.string().trim().max(300).optional() });
export const creditProceedsSchema = z.object({ accountId: zId, date: zIsoDate, creditedAmount: zMoney.optional() });

// ---- Settings / FX ----
export const patchSettingsSchema = z.object({
  name: z.string().trim().max(120).optional(),
  timezone: z.string().trim().max(64).optional(),
  baseCurrency: CURRENCY.optional(),
  secondaryCurrency: CURRENCY.nullish(),
  budgetCurrency: CURRENCY.nullish(),
  exchangeRateMode: z.enum(["AUTOMATIC", "MANUAL"]).optional(),
  notifyUpcomingCredits: z.boolean().optional(),
  notifyUpcomingBills: z.boolean().optional(),
  budgetAlertThreshold: zInt.refine((n) => n >= 1 && n <= 100, "out of range").optional(),
  isOnboarded: z.boolean().optional(),
});
export const setExchangeRateSchema = z.object({ targetCurrency: CURRENCY, rate: zPositive });
