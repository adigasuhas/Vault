import { dateOnly, isoDate, neighbours, nthOccurrence, occurrencesBetween, type Frequency } from "@/lib/dates";

/**
 * The one recurrence engine, shared by the server (Upcoming dates, budgets,
 * reminders, due runs) and the schedule editor's preview, so they can never
 * disagree about which dates a schedule produces.
 *
 * Pure: no database, safe to import from client components.
 *
 * Conventions:
 * - A schedule's n-th nominal date is computed from its anchor (`startDate`),
 *   never from the previous date. Monthly-style dates keep the anchor's day,
 *   clamped to short months: anchored on the 31st → 30 Apr, 28/29 Feb, 31 May.
 * - An override moves (or re-prices) one nominal occurrence. The date the user
 *   set is authoritative for that occurrence; nothing regenerates it.
 * - A stored occurrence (due, booked, skipped) is history and always wins over
 *   the rule.
 */

export type OccurrenceStatus = "SCHEDULED" | "PENDING" | "CONFIRMED" | "SKIPPED" | "FAILED" | "REVERSED";

export interface RuleLike {
  startDate: Date;
  frequency: Frequency | string;
  customIntervalDays?: number | null;
  endDate?: Date | null;
}

export interface OverrideLike {
  occurrenceDate: Date;
  date: Date | null;
  amount: number | { toString(): string } | null;
}

export interface ExecutionLike {
  id: string;
  occurrenceDate: Date | null;
  executedDate: Date;
  amount: number | { toString(): string };
  status: string;
  failureReason?: string | null;
  note?: string | null;
}

export interface ScheduleLike extends RuleLike {
  id: string;
  name: string;
  direction: "INCOME" | "PAYMENT";
  kind: string;
  amount: number | { toString(): string };
  currency: string;
  receivingAccountId: string | null;
  categoryId: string | null;
  nextExecutionDate: Date;
  isActive: boolean;
  overrides: OverrideLike[];
  executions: ExecutionLike[];
}

export interface Occurrence {
  scheduleId: string;
  scheduleName: string;
  direction: "INCOME" | "PAYMENT";
  kind: string;
  occurrenceDate: string; // nominal, YYYY-MM-DD
  date: string; // effective (override or nominal)
  amount: number;
  currency: string;
  /** Null: a payment with no account set yet (see accountForOccurrence). */
  accountId: string | null;
  categoryId: string | null;
  status: OccurrenceStatus;
  executionId: string | null;
  overridden: boolean;
  /** Which parts of the occurrence were set by hand. */
  dateOverridden: boolean;
  amountOverridden: boolean;
  failureReason?: string | null;
  note?: string | null;
}

const num = (v: number | { toString(): string }) => (typeof v === "number" ? v : Number(v.toString()));

function ruleOf(s: RuleLike) {
  return { startDate: s.startDate, frequency: s.frequency as Frequency, customIntervalDays: s.customIntervalDays, endDate: s.endDate };
}

/** Occurrences of one schedule whose *effective* date falls in [from, to],
 * merging stored executions (what happened) with projections (what will). */
export function projectOccurrences(s: ScheduleLike, from: Date, to: Date): Occurrence[] {
  const overrides = new Map(s.overrides.map((o) => [dateOnly(o.occurrenceDate).getTime(), o]));
  const byNominal = new Set<number>();
  for (const x of s.executions) if (x.occurrenceDate) byNominal.add(dateOnly(x.occurrenceDate).getTime());
  const base = {
    scheduleId: s.id,
    scheduleName: s.name,
    direction: s.direction,
    kind: s.kind,
    currency: s.currency,
    accountId: s.receivingAccountId,
    categoryId: s.categoryId,
  };
  const out: Occurrence[] = [];
  const seen = new Set<string>();

  // Stored occurrences (any status) in range.
  for (const x of s.executions) {
    const eff = dateOnly(x.executedDate);
    if (eff < from || eff > to) continue;
    const nominal = x.occurrenceDate ? dateOnly(x.occurrenceDate) : eff;
    const ov = overrides.get(nominal.getTime());
    seen.add(isoDate(nominal));
    out.push({
      ...base,
      occurrenceDate: isoDate(nominal),
      date: isoDate(eff),
      amount: num(x.amount),
      status: x.status as OccurrenceStatus,
      executionId: x.id,
      overridden: !!ov,
      dateOverridden: !!ov?.date,
      amountOverridden: ov?.amount != null,
      failureReason: x.failureReason,
      note: x.note,
    });
  }

  // Projections — only for an active schedule, from its next unprocessed
  // nominal date onward. Widen the nominal window so an override that pulls
  // an occurrence into range is still found.
  if (s.isActive) {
    const pad = 400 * 86_400_000;
    const nominals = occurrencesBetween(ruleOf(s), new Date(Math.max(from.getTime() - pad, 0)), new Date(to.getTime() + pad));
    const next = dateOnly(s.nextExecutionDate);
    for (const n of nominals) {
      if (n < next) continue;
      const key = isoDate(n);
      if (seen.has(key) || byNominal.has(n.getTime())) continue;
      const ov = overrides.get(n.getTime());
      const eff = ov?.date ? dateOnly(ov.date) : n;
      if (eff < from || eff > to) continue;
      out.push({
        ...base,
        occurrenceDate: key,
        date: isoDate(eff),
        amount: ov?.amount != null ? num(ov.amount) : num(s.amount),
        status: "SCHEDULED",
        executionId: null,
        overridden: !!ov,
        dateOverridden: !!ov?.date,
        amountOverridden: ov?.amount != null,
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** The next `count` nominal dates of a rule from `from` (inclusive), honouring
 * the end date. Indexed from the anchor, so month-end anchors never drift. */
export function nominalsFrom(rule: RuleLike, from: Date, count: number): Date[] {
  const freq = rule.frequency as Frequency;
  const start = dateOnly(rule.startDate);
  const end = rule.endDate ? dateOnly(rule.endDate) : null;
  if (freq === "ONE_TIME") return start >= dateOnly(from) && (!end || start <= end) ? [start] : [];
  const out: Date[] = [];
  const f = dateOnly(from);
  for (let n = 0; n < 20_000 && out.length < count; n++) {
    const d = nthOccurrence(start, freq, n, rule.customIntervalDays);
    if (end && d > end) break;
    if (d >= f) out.push(d);
  }
  return out;
}

export function isNominalOf(rule: RuleLike, d: Date): boolean {
  const day = dateOnly(d);
  return occurrencesBetween(ruleOf(rule), day, day).some((n) => n.getTime() === day.getTime());
}

/** Why a moved date can't be used for this occurrence, or null when it can.
 * A moved date stays inside the occurrence's own period (after the previous
 * nominal date, before the next) so occurrences never swap order. */
export function overrideDateProblem(rule: RuleLike, nominal: Date, date: Date): string | null {
  if ((rule.frequency as Frequency) === "ONE_TIME") return null;
  const { prev, next } = neighbours(ruleOf(rule), dateOnly(nominal));
  const d = dateOnly(date);
  if ((prev && d <= prev) || (next && d >= next)) {
    return `Keep this date between ${prev ? isoDate(prev) : "the start"} and ${next ? isoDate(next) : "the end"}. To go further, move the next one instead.`;
  }
  return null;
}

/** When a schedule's pattern changes (new start, frequency or interval), which
 * of its future hand-set dates and amounts still belong to it: those whose
 * nominal date the new rule also produces, with a moved date that still fits
 * its period. Anything before `today` is history and kept as is. */
export function overridesKeptOnReanchor<T extends OverrideLike>(newRule: RuleLike, overrides: T[], today: Date): { kept: T[]; dropped: T[] } {
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const o of overrides) {
    const nominal = dateOnly(o.occurrenceDate);
    if (nominal < dateOnly(today)) {
      kept.push(o);
      continue;
    }
    const fits = isNominalOf(newRule, nominal) && (!o.date || !overrideDateProblem(newRule, nominal, o.date));
    (fits ? kept : dropped).push(o);
  }
  return { kept, dropped };
}
