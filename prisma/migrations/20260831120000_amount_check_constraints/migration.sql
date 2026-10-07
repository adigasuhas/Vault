-- Phase 1 — F1 / F2 / F21: enforce sign/amount invariants at the database level so
-- a route-level bug can never again write a negative expense, a backwards transfer,
-- or a zero/negative-quantity holding.
--
-- Prisma cannot express CHECK constraints in schema.prisma, so this migration is
-- hand-written (see docs/DEVELOPER.md section 5) and applied with
-- `npx prisma migrate deploy`.
--
-- PRE-EXISTING DATA: these `ADD CONSTRAINT` statements fail if the table already
-- holds a violating row. A database that was exposed to the negative-amount bug
-- must be reconciled first — reverse the balance impact of each bad Transfer /
-- LedgerEntry (the same "undo exactly what happened" approach as
-- reverseCreditExecution / deleteExpense) and delete the offending rows — before
-- running this migration. The local dev database was cleaned on 2026-08-31.

ALTER TABLE "Expense"
  ADD CONSTRAINT "Expense_amount_positive" CHECK ("amount" > 0);

ALTER TABLE "Transfer"
  ADD CONSTRAINT "Transfer_amount_positive" CHECK ("amount" > 0);

ALTER TABLE "ScheduledCredit"
  ADD CONSTRAINT "ScheduledCredit_amount_positive" CHECK ("amount" > 0);

ALTER TABLE "CreditExecution"
  ADD CONSTRAINT "CreditExecution_amount_positive" CHECK ("amount" > 0);

-- Every ledger type carries a positive magnitude EXCEPT ADJUSTMENT, which stores
-- a signed delta (and is never exactly zero — adjustOpeningBalance no-ops a zero
-- delta before writing).
ALTER TABLE "LedgerEntry"
  ADD CONSTRAINT "LedgerEntry_amount_valid" CHECK (
    ("type" = 'ADJUSTMENT' AND "amount" <> 0)
    OR ("type" <> 'ADJUSTMENT' AND "amount" > 0)
  );

ALTER TABLE "StockHolding"
  ADD CONSTRAINT "StockHolding_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "StockHolding_avgBuyPrice_nonneg" CHECK ("avgBuyPrice" >= 0);

ALTER TABLE "StockPurchaseLot"
  ADD CONSTRAINT "StockPurchaseLot_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "StockPurchaseLot_price_nonneg" CHECK ("price" >= 0);

ALTER TABLE "MutualFundHolding"
  ADD CONSTRAINT "MutualFundHolding_units_positive" CHECK ("units" > 0),
  ADD CONSTRAINT "MutualFundHolding_avgNav_nonneg" CHECK ("avgNav" >= 0);
