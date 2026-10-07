export const SUPPORTED_CURRENCIES = [
  { code: "INR", label: "Indian Rupee", symbol: "₹" },
  { code: "USD", label: "US Dollar", symbol: "$" },
  { code: "GBP", label: "British Pound", symbol: "£" },
  { code: "EUR", label: "Euro", symbol: "€" },
  { code: "JPY", label: "Japanese Yen", symbol: "¥" },
  { code: "AUD", label: "Australian Dollar", symbol: "A$" },
  { code: "SGD", label: "Singapore Dollar", symbol: "S$" },
  { code: "CHF", label: "Swiss Franc", symbol: "CHF" },
  { code: "CAD", label: "Canadian Dollar", symbol: "C$" },
] as const;

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number]["code"];

// Format each currency in its own locale so grouping/decimals read naturally
// (₹1,21,537 in en-IN, $121,537 in en-US) instead of forcing Indian grouping on
// everything (finding U3).
const CURRENCY_LOCALE: Record<string, string> = {
  INR: "en-IN",
  USD: "en-US",
  GBP: "en-GB",
  EUR: "de-DE",
  JPY: "en-US", // en-US renders the standard "¥" (ja-JP uses the fullwidth "￥")
  AUD: "en-AU",
  SGD: "en-SG",
  CHF: "de-CH",
  CAD: "en-CA",
};

// Currencies with no minor unit.
const ZERO_DECIMAL = new Set(["JPY"]);

export function formatMoney(amount: number | string, currency: string, locale?: string) {
  const raw = typeof amount === "string" ? Number(amount) : amount;
  const value = Number.isFinite(raw) ? raw : 0;
  const resolvedLocale = locale ?? CURRENCY_LOCALE[currency] ?? "en-US";
  // Whole amounts show without the trailing ".00"; fractional amounts keep 2dp.
  const fractionDigits = ZERO_DECIMAL.has(currency) ? 0 : Number.isInteger(value) ? 0 : 2;
  try {
    return new Intl.NumberFormat(resolvedLocale, {
      style: "currency",
      currency,
      currencyDisplay: "symbol",
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(fractionDigits)}`;
  }
}

/**
 * Compact form for chart axes and dense tiles: ₹1.2L / ₹1.2Cr for INR (Indian
 * numbering), $1.2k / $1.2M elsewhere. Used to stop 6-digit rupee labels from
 * being clipped on a narrow Y-axis (finding F14).
 */
export function formatCompactMoney(amount: number, currency: string): string {
  const symbol = SUPPORTED_CURRENCIES.find((c) => c.code === currency)?.symbol ?? "";
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);

  const trim = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ""));

  if (currency === "INR") {
    if (abs >= 1e7) return `${sign}${symbol}${trim(abs / 1e7)}Cr`;
    if (abs >= 1e5) return `${sign}${symbol}${trim(abs / 1e5)}L`;
    if (abs >= 1e3) return `${sign}${symbol}${trim(abs / 1e3)}k`;
    return `${sign}${symbol}${Math.round(abs)}`;
  }

  if (abs >= 1e9) return `${sign}${symbol}${trim(abs / 1e9)}B`;
  if (abs >= 1e6) return `${sign}${symbol}${trim(abs / 1e6)}M`;
  if (abs >= 1e3) return `${sign}${symbol}${trim(abs / 1e3)}k`;
  return `${sign}${symbol}${Math.round(abs)}`;
}
