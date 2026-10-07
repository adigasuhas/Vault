import { db } from "@/lib/db";
import { authed } from "@/lib/api";
import { createFxConverter } from "@/lib/fx";
import { SUPPORTED_CURRENCIES } from "@/lib/currencies";

export const dynamic = "force-dynamic";

/** The viewer's currency setup and the rates needed to show "≈" equivalents:
 * for each supported currency, how many units of primary / secondary one unit
 * buys. Rates are refreshed server-side when older than 12 hours. */
export const GET = authed(async (_req, { userId }) => {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { baseCurrency: true, secondaryCurrency: true, budgetCurrency: true, exchangeRateMode: true },
  });
  const fx = await createFxConverter(userId, user.baseCurrency);
  const toPrimary: Record<string, number | null> = {};
  const toSecondary: Record<string, number | null> = {};
  for (const { code } of SUPPORTED_CURRENCIES) {
    toPrimary[code] = fx.rate(code, user.baseCurrency);
    toSecondary[code] = user.secondaryCurrency ? fx.rate(code, user.secondaryCurrency) : null;
  }
  const asOf = fx.asOf;
  return {
    primary: user.baseCurrency,
    secondary: user.secondaryCurrency,
    budgetCurrency: user.budgetCurrency ?? user.baseCurrency,
    mode: user.exchangeRateMode,
    asOf,
    stale: asOf ? Date.now() - asOf.getTime() > 36 * 60 * 60 * 1000 : true,
    toPrimary,
    toSecondary,
  };
});
