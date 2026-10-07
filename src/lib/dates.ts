/**
 * Calendar-date helpers.
 *
 * Convention: every money event carries a *calendar date*, stored as UTC
 * midnight of that date (a "YYYY-MM-DD" from a date input parses to exactly
 * that). Month bucketing is then a plain `toISOString().slice(0, 7)` and never
 * depends on the server's timezone. All arithmetic here is UTC-only — date-fns
 * helpers use local getters and can shift a UTC-midnight date across a day
 * boundary on servers that observe DST.
 */

export type Frequency = "ONE_TIME" | "WEEKLY" | "MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "YEARLY" | "CUSTOM";

export function dateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Today's calendar date in an IANA timezone, as UTC midnight. */
export function todayIn(timeZone = "UTC", now: Date = new Date()): Date {
  let parts: Record<string, string>;
  try {
    parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
        .formatToParts(now)
        .map((p) => [p.type, p.value])
    );
  } catch {
    return dateOnly(now);
  }
  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7);
}

export function monthRange(month: string): { start: Date; end: Date } {
  const [y, m] = month.split("-").map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  return monthKey(new Date(Date.UTC(y, m - 1 + delta, 1)));
}

export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to && out.length < 600; m = shiftMonth(m, 1)) out.push(m);
  return out;
}

export function lastNMonths(n: number, endMonth: string): string[] {
  return monthsBetween(shiftMonth(endMonth, -(n - 1)), endMonth);
}

export function addDaysUTC(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

/** Adds months keeping the day-of-month, clamped to the target month's length
 * (31 Jan + 1 month = 28/29 Feb). */
export function addMonthsUTC(d: Date, months: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), lastDay)));
}

/** The n-th (0-based) nominal occurrence of a recurrence anchored at `start`.
 * Computed from the anchor, never from the previous occurrence, so a schedule
 * starting on the 31st doesn't drift to the 28th after February. */
export function nthOccurrence(start: Date, frequency: Frequency, n: number, customIntervalDays?: number | null): Date {
  const s = dateOnly(start);
  switch (frequency) {
    case "ONE_TIME":
      return s;
    case "WEEKLY":
      return addDaysUTC(s, 7 * n);
    case "QUARTERLY":
      return addMonthsUTC(s, 3 * n);
    case "HALF_YEARLY":
      return addMonthsUTC(s, 6 * n);
    case "YEARLY":
      return addMonthsUTC(s, 12 * n);
    case "CUSTOM": {
      const days = Math.min(Math.max(customIntervalDays || 30, 1), 3650);
      return addDaysUTC(s, days * n);
    }
    case "MONTHLY":
    default:
      return addMonthsUTC(s, n);
  }
}

/** Nominal occurrence dates in [from, to] (inclusive), honoring endDate. */
export function occurrencesBetween(
  rule: { startDate: Date; frequency: Frequency; customIntervalDays?: number | null; endDate?: Date | null },
  from: Date,
  to: Date,
  limit = 400
): Date[] {
  const out: Date[] = [];
  const end = rule.endDate ? dateOnly(rule.endDate) : null;
  if (rule.frequency === "ONE_TIME") {
    const d = dateOnly(rule.startDate);
    return d >= from && d <= to ? [d] : [];
  }
  for (let n = 0; n < 5000 && out.length < limit; n++) {
    const d = nthOccurrence(rule.startDate, rule.frequency, n, rule.customIntervalDays);
    if (d > to || (end && d > end)) break;
    if (d >= from) out.push(d);
  }
  return out;
}

/** Nominal occurrences immediately before and after `date` (used to keep an
 * overridden occurrence inside its own period). */
export function neighbours(
  rule: { startDate: Date; frequency: Frequency; customIntervalDays?: number | null },
  date: Date
): { prev: Date | null; next: Date | null } {
  if (rule.frequency === "ONE_TIME") return { prev: null, next: null };
  let prev: Date | null = null;
  for (let n = 0; n < 5000; n++) {
    const d = nthOccurrence(rule.startDate, rule.frequency, n, rule.customIntervalDays);
    if (d.getTime() === date.getTime()) {
      return { prev, next: nthOccurrence(rule.startDate, rule.frequency, n + 1, rule.customIntervalDays) };
    }
    if (d > date) return { prev, next: d };
    prev = d;
  }
  return { prev, next: null };
}

/** The first date a new schedule pre-fills: today, whatever the frequency,
 * so the first payment lands in the month it's set up for (the user picks
 * another date if it starts later). */
export function defaultStartDate(_frequency: Frequency, today: Date): Date {
  return today;
}

export function monthLabel(month: string, style: "long" | "short" = "long"): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", {
    month: style,
    year: "numeric",
    timeZone: "UTC",
  });
}
