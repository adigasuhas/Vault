import { db } from "@/lib/db";
import { createFxConverter, type FxConverter } from "@/lib/fx";
import { fdCurrentValue } from "@/lib/investments";
import { proceedsLeft } from "@/lib/investment-sales";

/**
 * Single source of truth for "what is the investment portfolio worth right now",
 * converted to the user's base currency.
 *
 * Previously the dashboard, analytics and PDF reports each computed this
 * independently, and the reports valued fixed deposits at raw principal while
 * the other two used the accrued value — so a report's net-worth figure could
 * disagree with the dashboard's (finding F10). All three now call this.
 */

export interface PortfolioValue {
  stocks: number;
  funds: number;
  deposits: number;
  other: number;
  /** Sale proceeds kept for reinvestment and not yet used or moved to an account. */
  proceeds: number;
  total: number;
  holdings: {
    stocks: Awaited<ReturnType<typeof db.stockHolding.findMany>>;
    funds: Awaited<ReturnType<typeof db.mutualFundHolding.findMany>>;
    deposits: Awaited<ReturnType<typeof db.fixedDeposit.findMany>>;
    other: Awaited<ReturnType<typeof db.otherAsset.findMany>>;
  };
}

export async function computePortfolioValue(
  userId: string,
  baseCurrency: string,
  converter?: FxConverter
): Promise<PortfolioValue> {
  const fx = converter ?? (await createFxConverter(userId, baseCurrency));

  const [stocks, funds, deposits, other, kept] = await Promise.all([
    db.stockHolding.findMany({ where: { userId } }),
    db.mutualFundHolding.findMany({ where: { userId } }),
    db.fixedDeposit.findMany({ where: { userId } }),
    db.otherAsset.findMany({ where: { userId } }),
    db.investmentSale.findMany({ where: { userId, accountId: null, reversedAt: null } }),
  ]);

  const stockValue = stocks.reduce(
    (sum, s) => sum + fx.convert(Number(s.lastPrice ?? s.avgBuyPrice) * Number(s.quantity), s.currency),
    0
  );
  const fundValue = funds.reduce(
    (sum, f) => sum + fx.convert(Number(f.lastNav ?? f.avgNav) * Number(f.units), f.currency),
    0
  );
  const depositValue = deposits.reduce(
    (sum, d) =>
      sum +
      fx.convert(
        fdCurrentValue(Number(d.principal), Number(d.interestRate), d.startDate, d.maturityDate),
        d.currency
      ),
    0
  );
  const otherValue = other.reduce((sum, a) => sum + fx.convert(Number(a.currentValue), a.currency), 0);
  // Money from a sale that hasn't been reinvested or moved to an account is
  // still part of the portfolio — otherwise selling to reinvest would make
  // net worth dip until the new purchase is recorded.
  const proceedsValue = kept.reduce((sum, s) => sum + fx.convert(proceedsLeft(s), s.currency), 0);

  return {
    stocks: stockValue,
    funds: fundValue,
    deposits: depositValue,
    other: otherValue,
    proceeds: proceedsValue,
    total: stockValue + fundValue + depositValue + otherValue + proceedsValue,
    holdings: { stocks, funds, deposits, other },
  };
}
