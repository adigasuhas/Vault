import { describe, it, expect } from "vitest";
import { nominalsFrom, isNominalOf, overrideDateProblem, overridesKeptOnReanchor, projectOccurrences, type ScheduleLike } from "@/lib/recurrence";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const iso = (x: Date) => x.toISOString().slice(0, 10);
const rule = (startDate: string, frequency: string, extra: { customIntervalDays?: number; endDate?: string } = {}) => ({
  startDate: d(startDate),
  frequency,
  customIntervalDays: extra.customIntervalDays ?? null,
  endDate: extra.endDate ? d(extra.endDate) : null,
});

describe("nominalsFrom", () => {
  it("keeps a month-end anchor through short months (clamped, never drifting)", () => {
    expect(nominalsFrom(rule("2027-01-31", "MONTHLY"), d("2027-01-01"), 5).map(iso)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30", "2027-05-31"]);
    expect(nominalsFrom(rule("2027-01-30", "MONTHLY"), d("2027-02-01"), 2).map(iso)).toEqual(["2027-02-28", "2027-03-30"]);
    expect(nominalsFrom(rule("2027-01-29", "MONTHLY"), d("2028-02-01"), 1).map(iso)).toEqual(["2028-02-29"]);
  });
  it("starts from a clamped next date without re-anchoring on it (leap-day yearly)", () => {
    // Next date is 28 Feb 2027 only because 2027 has no 29 Feb; 2028 is the 29th again.
    expect(nominalsFrom(rule("2024-02-29", "YEARLY"), d("2027-02-28"), 3).map(iso)).toEqual(["2027-02-28", "2028-02-29", "2029-02-28"]);
  });
  it("covers every supported frequency, across year boundaries", () => {
    expect(nominalsFrom(rule("2026-12-24", "WEEKLY"), d("2026-12-24"), 3).map(iso)).toEqual(["2026-12-24", "2026-12-31", "2027-01-07"]);
    expect(nominalsFrom(rule("2026-11-30", "QUARTERLY"), d("2026-11-30"), 3).map(iso)).toEqual(["2026-11-30", "2027-02-28", "2027-05-30"]);
    expect(nominalsFrom(rule("2026-08-31", "HALF_YEARLY"), d("2026-08-31"), 3).map(iso)).toEqual(["2026-08-31", "2027-02-28", "2027-08-31"]);
    expect(nominalsFrom(rule("2026-12-31", "YEARLY"), d("2026-12-31"), 2).map(iso)).toEqual(["2026-12-31", "2027-12-31"]);
    expect(nominalsFrom(rule("2026-12-20", "CUSTOM", { customIntervalDays: 10 }), d("2026-12-20"), 3).map(iso)).toEqual(["2026-12-20", "2026-12-30", "2027-01-09"]);
    expect(nominalsFrom(rule("2026-11-05", "ONE_TIME"), d("2026-11-01"), 5).map(iso)).toEqual(["2026-11-05"]);
  });
  it("stops at the end date", () => {
    expect(nominalsFrom(rule("2026-11-05", "MONTHLY", { endDate: "2027-01-31" }), d("2026-11-01"), 10).map(iso)).toEqual(["2026-11-05", "2026-12-05", "2027-01-05"]);
  });
});

describe("overrideDateProblem", () => {
  const r = rule("2026-11-05", "MONTHLY");
  it("allows a date within its own period", () => {
    expect(overrideDateProblem(r, d("2026-12-05"), d("2026-12-08"))).toBeNull();
    expect(overrideDateProblem(r, d("2026-12-05"), d("2026-11-06"))).toBeNull();
  });
  it("rejects a date that would swap order with a neighbour", () => {
    expect(overrideDateProblem(r, d("2026-12-05"), d("2027-01-05"))).toMatch(/between 2026-11-05 and 2027-01-05/);
    expect(overrideDateProblem(r, d("2026-12-05"), d("2026-11-05"))).toMatch(/between/);
  });
});

describe("overridesKeptOnReanchor", () => {
  const today = d("2026-10-24");
  const ov = (occurrenceDate: string, date: string | null, amount: number | null = null) => ({ occurrenceDate: d(occurrenceDate), date: date ? d(date) : null, amount });
  it("keeps hand-set dates the new pattern still has, drops the rest", () => {
    // Monthly on the 5th → quarterly from the same 5 Nov: 5 Feb survives, 5 Dec doesn't.
    const { kept, dropped } = overridesKeptOnReanchor(rule("2026-11-05", "QUARTERLY"), [ov("2026-12-05", "2026-12-08"), ov("2027-02-05", "2027-02-07"), ov("2027-03-05", null, 90000)], today);
    expect(kept.map((o) => iso(o.occurrenceDate))).toEqual(["2027-02-05"]);
    expect(dropped.map((o) => iso(o.occurrenceDate))).toEqual(["2026-12-05", "2027-03-05"]);
  });
  it("drops a moved date that no longer fits its period", () => {
    // Weekly from 5 Nov still has 3 Dec, but a move to 12 Dec now jumps past 10 Dec.
    const { kept, dropped } = overridesKeptOnReanchor(rule("2026-11-05", "WEEKLY"), [ov("2026-12-03", "2026-12-12"), ov("2026-12-10", "2026-12-11")], today);
    expect(dropped.map((o) => iso(o.occurrenceDate))).toEqual(["2026-12-03"]);
    expect(kept.map((o) => iso(o.occurrenceDate))).toEqual(["2026-12-10"]);
  });
  it("leaves history before today alone", () => {
    const { kept } = overridesKeptOnReanchor(rule("2026-11-10", "MONTHLY"), [ov("2026-09-05", "2026-09-07")], today);
    expect(kept).toHaveLength(1);
  });
});

describe("projectOccurrences", () => {
  const schedule = (over: Partial<ScheduleLike>): ScheduleLike => ({
    id: "s1",
    name: "Salary",
    direction: "INCOME",
    kind: "SALARY",
    amount: 82000,
    currency: "INR",
    receivingAccountId: "a1",
    categoryId: null,
    startDate: d("2026-11-05"),
    frequency: "MONTHLY",
    customIntervalDays: null,
    endDate: null,
    nextExecutionDate: d("2026-11-05"),
    isActive: true,
    overrides: [],
    executions: [],
    ...over,
  });
  it("uses the saved moved date and says which part was set by hand", () => {
    const out = projectOccurrences(
      schedule({ overrides: [{ occurrenceDate: d("2026-12-05"), date: d("2026-12-08"), amount: null }, { occurrenceDate: d("2027-01-05"), date: null, amount: 85000 }] }),
      d("2026-11-01"),
      d("2027-01-31")
    );
    expect(out.map((o) => [o.occurrenceDate, o.date, o.amount, o.dateOverridden, o.amountOverridden])).toEqual([
      ["2026-11-05", "2026-11-05", 82000, false, false],
      ["2026-12-05", "2026-12-08", 82000, true, false],
      ["2027-01-05", "2027-01-05", 85000, false, true],
    ]);
  });
  it("never lists an occurrence twice when it's stored and also on the rule", () => {
    const out = projectOccurrences(
      schedule({ executions: [{ id: "x", occurrenceDate: d("2026-12-05"), executedDate: d("2026-12-05"), amount: 82000, status: "SKIPPED" }] }),
      d("2026-11-01"),
      d("2027-01-31")
    );
    expect(out.map((o) => `${o.occurrenceDate}:${o.status}`)).toEqual(["2026-11-05:SCHEDULED", "2026-12-05:SKIPPED", "2027-01-05:SCHEDULED"]);
  });
  it("keeps two schedules on the same date apart", () => {
    const a = projectOccurrences(schedule({}), d("2026-11-01"), d("2026-11-30"));
    const b = projectOccurrences(schedule({ id: "s2", name: "Stipend", amount: 31000 }), d("2026-11-01"), d("2026-11-30"));
    const all = [...a, ...b];
    expect(all.map((o) => `${o.scheduleId}:${o.date}`)).toEqual(["s1:2026-11-05", "s2:2026-11-05"]);
  });
  it("agrees with the editor's list (same nominal dates, same start)", () => {
    const s = schedule({ startDate: d("2024-02-29"), frequency: "YEARLY", nextExecutionDate: d("2027-02-28") });
    const fromEngine = projectOccurrences(s, d("2027-01-01"), d("2030-12-31")).map((o) => o.occurrenceDate);
    const fromEditor = nominalsFrom(s, s.nextExecutionDate, 4).map(iso);
    expect(fromEditor).toEqual(fromEngine);
    expect(isNominalOf(s, d("2028-02-29"))).toBe(true);
    expect(isNominalOf(s, d("2028-02-28"))).toBe(false);
  });
});
