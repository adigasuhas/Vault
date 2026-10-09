/** Simple-interest accrual from start date to today, capped at the value
 * the deposit reaches at maturity — an approximation (real FDs often
 * compound), but a reasonable one for a "what is this worth right now"
 * figure. Shared by the Investments page and anywhere else (Dashboard,
 * Analytics) that needs a fixed deposit's current value rather than just
 * its principal. */
export function fdCurrentValue(principal: number, annualRatePercent: number, startDate: Date | string, maturityDate: Date | string, asOf: Date | string | number = Date.now()) {
  const start = new Date(startDate).getTime();
  const maturity = new Date(maturityDate).getTime();
  const now = new Date(asOf).getTime();
  const elapsedMs = Math.min(Math.max(now - start, 0), maturity - start);
  const yearsElapsed = elapsedMs / (365.25 * 24 * 60 * 60 * 1000);
  return principal * (1 + (annualRatePercent / 100) * yearsElapsed);
}
