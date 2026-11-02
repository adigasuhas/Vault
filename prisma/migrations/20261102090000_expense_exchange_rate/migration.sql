-- An expense can be reported in a currency other than its account's (₹ spent
-- from a £ card). It keeps the reported amount and currency, plus what left
-- the account (in the account's currency) and the rate the user confirmed.
-- Both are null for same-currency expenses, i.e. every existing row.
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "accountAmount" DECIMAL(65,30);
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "exchangeRate" DECIMAL(65,30);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Expense_accountAmount_positive') THEN
        ALTER TABLE "Expense" ADD CONSTRAINT "Expense_accountAmount_positive" CHECK ("accountAmount" IS NULL OR "accountAmount" > 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Expense_exchangeRate_positive') THEN
        ALTER TABLE "Expense" ADD CONSTRAINT "Expense_exchangeRate_positive" CHECK ("exchangeRate" IS NULL OR "exchangeRate" > 0);
    END IF;
END $$;
