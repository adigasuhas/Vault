-- A loan's startDate now means its first EMI's due date (it used to be the
-- disbursal date, with the first EMI a month later). Move existing loans'
-- startDate forward a month so their EMI dates stay where they were.
UPDATE "Loan" SET "startDate" = "startDate" + INTERVAL '1 month';
