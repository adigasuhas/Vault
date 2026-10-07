import { db } from "@/lib/db";
import { Prisma, type ScheduledCredit, type CreditExecution, type ScheduleOverride } from "@prisma/client";
import { ValidationError } from "@/lib/validate";
import { createFxConverter } from "@/lib/fx";
import { audit, postOccurrence, recordLoanPayment, reverseOccurrenceEntry, assertSufficientFunds, type Tx } from "@/lib/ledger";
import {
  dateOnly,
  isoDate,
  monthKey,
  monthRange,
  neighbours,
  nthOccurrence,
  occurrencesBetween,
  todayIn,
  type Frequency,
} from "@/lib/dates";

/**
 * Schedules: recurring or one-time income (salary, stipend, refunds) and
 * outgoing payments (rent, EMIs, subscriptions). One engine for both.
 *
 * A schedule is a rule (start date + frequency [+ end date]). Its n-th nominal
 * occurrence is computed from the anchor; a ScheduleOverride can move a single
 * occurrence to another date (within its own period) or change its amount.
 * When an occurrence comes due it becomes a CreditExecution:
 *   PENDING   — waiting for the user to confirm (default)
 *   CONFIRMED — booked to the ledger (shown as "Received"/"Paid")
 *   SKIPPED   — dismissed by the user (can be done ahead of time)
 *   FAILED    — auto-booking couldn't post (closed account, no funds…)
 *   REVERSED  — booked, then cancelled with a REVERSAL entry
 * Occurrences that aren't due yet are "scheduled" — projected, not stored.
 */

export const INCOME_KINDS = ["SALARY", "STIPEND", "REFUND", "POCKET_MONEY", "OTHER_INCOME"] as const;
export const PAYMENT_KINDS = ["RENT", "EMI", "SUBSCRIPTION", "INSURANCE", "FEES", "UTILITIES", "OTHER_PAYMENT"] as const;

export type OccurrenceStatus = "SCHEDULED" | "PENDING" | "CONFIRMED" | "SKIPPED" | "FAILED" | "REVERSED";

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
  failureReason?: string | null;
  note?: string | null;
}

type ScheduleWithRelations = ScheduledCredit & {
  overrides: ScheduleOverride[];
  executions: CreditExecution[];
};

function rule(s: ScheduledCredit) {
  return {
    startDate: s.startDate,
    frequency: s.frequency as Frequency,
    customIntervalDays: s.customIntervalDays,
    endDate: s.endDate,
  };
}

/** Occurrences of one schedule whose *effective* date falls in [from, to],
 * merging stored executions (what happened) with projections (what will). */
export function projectSchedule(s: ScheduleWithRelations, from: Date, to: Date): Occurrence[] {
  const overrides = new Map(s.overrides.map((o) => [dateOnly(o.occurrenceDate).getTime(), o]));
  const byNominal = new Map<number, CreditExecution>();
  const legacy: CreditExecution[] = [];
  for (const x of s.executions) {
    if (x.occurrenceDate) byNominal.set(dateOnly(x.occurrenceDate).getTime(), x);
    else legacy.push(x);
  }
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
    seen.add(isoDate(nominal));
    out.push({
      ...base,
      occurrenceDate: isoDate(nominal),
      date: isoDate(eff),
      amount: Number(x.amount),
      status: x.status as OccurrenceStatus,
      executionId: x.id,
      overridden: overrides.has(nominal.getTime()),
      failureReason: x.failureReason,
      note: x.note,
    });
  }

  // Projections — only for an active schedule, from its next unprocessed
  // nominal date onward. Widen the nominal window so an override that pulls
  // an occurrence into range is still found.
  if (s.isActive) {
    const pad = 400 * 86_400_000;
    const nominals = occurrencesBetween(rule(s), new Date(Math.max(from.getTime() - pad, 0)), new Date(to.getTime() + pad));
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
        amount: ov?.amount != null ? Number(ov.amount) : Number(s.amount),
        status: "SCHEDULED",
        executionId: null,
        overridden: !!ov,
      });
    }
  }
  void legacy;
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Every user occurrence in [from, to] across schedules. */
export async function loadOccurrences(
  userId: string,
  from: Date,
  to: Date,
  opts: { direction?: "INCOME" | "PAYMENT"; scheduleId?: string } = {}
): Promise<Occurrence[]> {
  const schedules = await db.scheduledCredit.findMany({
    where: {
      userId,
      ...(opts.direction ? { direction: opts.direction } : {}),
      ...(opts.scheduleId ? { id: opts.scheduleId } : {}),
    },
    include: { overrides: true, executions: true },
  });
  return schedules.flatMap((s) => projectSchedule(s, from, to)).sort((a, b) => a.date.localeCompare(b.date));
}

export async function userToday(userId: string): Promise<Date> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { timezone: true } });
  return todayIn(user?.timezone || "UTC");
}

// ------------------------------------------------------------- running due

const RUN_DUE_LOCK_KEY = 4_812_007;

/**
 * Materialises every occurrence that has come due (effective date <= today),
 * catching up any number of missed periods. Each schedule runs in its own
 * transaction, serialized by an advisory lock, and the unique
 * (schedule, occurrenceDate) key makes a double run harmless.
 */
export async function runDueSchedules(now: Date = new Date(), userId?: string) {
  const schedules = await db.scheduledCredit.findMany({
    where: { isActive: true, ...(userId ? { userId } : {}) },
    select: { id: true, userId: true, user: { select: { timezone: true } } },
  });
  const result = { checked: schedules.length, executed: 0, pending: 0, failed: 0 };

  for (const { id, user } of schedules) {
    const today = todayIn(user.timezone || "UTC", now);
    try {
      const r = await db.$transaction(async (tx: Tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${RUN_DUE_LOCK_KEY}, hashtext(${id}))`;
        return processSchedule(tx, id, today);
      });
      result.executed += r.executed;
      result.pending += r.pending;
      result.failed += r.failed;
    } catch (err) {
      console.error(`runDueSchedules: schedule ${id} failed`, err);
      result.failed++;
    }
  }
  return result;
}

async function processSchedule(tx: Tx, scheduleId: string, today: Date) {
  const r = { executed: 0, pending: 0, failed: 0 };
  const s = await tx.scheduledCredit.findUnique({ where: { id: scheduleId }, include: { overrides: true } });
  if (!s || !s.isActive) return r;
  const overrides = new Map(s.overrides.map((o) => [dateOnly(o.occurrenceDate).getTime(), o]));
  const end = s.endDate ? dateOnly(s.endDate) : null;
  const freq = s.frequency as Frequency;

  // Index of the next unprocessed nominal occurrence.
  let k = 0;
  const next = dateOnly(s.nextExecutionDate);
  if (freq !== "ONE_TIME") {
    while (k < 10_000 && nthOccurrence(s.startDate, freq, k, s.customIntervalDays) < next) k++;
  }

  for (let guard = 0; guard < 500; guard++) {
    const nominal = nthOccurrence(s.startDate, freq, k, s.customIntervalDays);
    if (end && nominal > end) {
      await tx.scheduledCredit.update({ where: { id: s.id }, data: { isActive: false } });
      return r;
    }
    const ov = overrides.get(nominal.getTime());
    const effective = ov?.date ? dateOnly(ov.date) : nominal;
    if (effective > today) break;

    const exists = await tx.creditExecution.findUnique({
      where: { scheduledCreditId_occurrenceDate: { scheduledCreditId: s.id, occurrenceDate: nominal } },
    });
    if (!exists) {
      const amount = ov?.amount != null ? Number(ov.amount) : Number(s.amount);
      // No account on the schedule or that month's budget line: it waits for
      // the user to say which account paid, even when set to auto-book.
      const accountId = s.requiresConfirmation ? null : await accountForOccurrence(tx, s, effective);
      if (s.requiresConfirmation || !accountId) {
        await tx.creditExecution.create({
          data: { scheduledCreditId: s.id, occurrenceDate: nominal, executedDate: effective, amount, status: "PENDING" },
        });
        r.pending++;
      } else {
        const { problem, booked } = await autoPostProblem(tx, { ...s, receivingAccountId: accountId }, amount);
        const x = await tx.creditExecution.create({
          data: {
            scheduledCreditId: s.id,
            occurrenceDate: nominal,
            executedDate: effective,
            amount,
            status: problem ? "FAILED" : "CONFIRMED",
            confirmedAt: problem ? null : new Date(),
            failureReason: problem,
          },
        });
        if (problem) {
          r.failed++;
        } else {
          await postOccurrence(tx, { ...s, receivingAccountId: accountId }, { id: x.id, amount, date: effective, booked: booked ?? undefined });
          r.executed++;
        }
      }
    }

    if (freq === "ONE_TIME") {
      await tx.scheduledCredit.update({ where: { id: s.id }, data: { isActive: false } });
      return r;
    }
    k++;
    await tx.scheduledCredit.update({
      where: { id: s.id },
      data: { nextExecutionDate: nthOccurrence(s.startDate, freq, k, s.customIntervalDays) },
    });
  }
  return r;
}

/** `amount` in `from` converted into `to` at the user's current rate,
 * rounded to the cent; null when no rate is known. */
export async function convertForAccount(tx: Tx, userId: string, amount: number, from: string, to: string): Promise<number | null> {
  if (from === to) return amount;
  const fx = await createFxConverter(userId, to, { refresh: false, client: tx });
  const v = fx.convertTo(amount, from, to);
  return v == null ? null : Math.round(v * 100) / 100;
}

/** The account an occurrence is paid from (or into): the schedule's own, or
 * — for a payment set up without one — the account on that month's budget
 * line for its category. Null when neither is set. */
export async function accountForOccurrence(
  tx: Tx,
  s: Pick<ScheduledCredit, "userId" | "receivingAccountId" | "categoryId">,
  date: Date
): Promise<string | null> {
  if (s.receivingAccountId) return s.receivingAccountId;
  if (!s.categoryId) return null;
  const line = await tx.budgetCategoryAllocation.findFirst({
    where: { categoryId: s.categoryId, accountId: { not: null }, budgetPlan: { userId: s.userId, month: monthKey(date) } },
    select: { accountId: true },
  });
  return line?.accountId ?? null;
}

/** Why an auto-post would fail, checked up front — a throw inside the
 * transaction would abort the whole schedule run. For a schedule in another
 * currency than its account, also works out the amount to book. */
async function autoPostProblem(tx: Tx, s: ScheduledCredit & { receivingAccountId: string }, amount: number): Promise<{ problem: string | null; booked: number | null }> {
  const fail = (problem: string) => ({ problem, booked: null });
  const account = await tx.account.findUnique({ where: { id: s.receivingAccountId } });
  if (!account) return fail("Account no longer exists.");
  if (account.status === "CLOSED") return fail(`${account.name} is closed.`);
  if (!(amount > 0)) return fail("Amount must be greater than zero.");
  let booked: number | null = null;
  if (account.currency !== s.currency) {
    if (s.loanId) return fail(`Currency mismatch (${s.currency} vs ${account.currency}).`);
    booked = await convertForAccount(tx, s.userId, amount, s.currency, account.currency);
    if (booked == null) return fail(`No ${s.currency} → ${account.currency} exchange rate to convert with. Confirm it by hand with the amount that moved.`);
  }
  if (s.direction === "PAYMENT") {
    try {
      assertSufficientFunds(account, booked ?? amount);
    } catch (e) {
      return fail(e instanceof Error ? e.message : "Insufficient balance.");
    }
  }
  if (s.loanId) {
    const loan = await tx.loan.findUnique({ where: { id: s.loanId } });
    if (!loan || loan.status === "CLOSED") return fail("The loan is closed.");
  }
  return { problem: null, booked };
}

// ------------------------------------------------------------- occurrence actions

async function loadExecution(tx: Tx, userId: string, executionId: string) {
  const x = await tx.creditExecution.findFirst({
    where: { id: executionId, scheduledCredit: { userId } },
    include: { scheduledCredit: true },
  });
  if (!x) throw new ValidationError("We couldn't find that item.");
  return x;
}

/** Books a PENDING (or retries a FAILED) occurrence. The user may correct the
 * amount actually received/paid, the date it happened, and the account.
 * `amount` is in the paying/receiving account's currency: for a schedule in
 * another currency it's what actually moved (defaulting to a conversion at
 * the current rate), and the scheduled amount itself stays as set. */
export async function confirmOccurrence(
  userId: string,
  executionId: string,
  input: { amount?: number; date?: Date; accountId?: string } = {}
) {
  return db.$transaction(async (tx: Tx) => {
    const x = await loadExecution(tx, userId, executionId);
    if (x.status !== "PENDING" && x.status !== "FAILED") {
      throw new ValidationError("This one has already been dealt with.");
    }
    const date = input.date ? dateOnly(input.date) : dateOnly(x.executedDate);
    const accountId = input.accountId ?? (await accountForOccurrence(tx, x.scheduledCredit, date));
    if (!accountId) throw new ValidationError(x.scheduledCredit.direction === "INCOME" ? "Choose the account it arrived in." : "Choose the account it was paid from.");
    const schedule = { ...x.scheduledCredit, receivingAccountId: accountId };
    const acct = await tx.account.findFirst({ where: { id: accountId, userId } });
    if (!acct) throw new ValidationError("Account not found.");
    const cross = acct.currency !== schedule.currency;
    let amount = input.amount ?? Number(x.amount);
    let booked: number | undefined;
    if (cross) {
      amount = Number(x.amount);
      const b = input.amount ?? (await convertForAccount(tx, userId, amount, schedule.currency, acct.currency));
      if (b == null) throw new ValidationError(`Enter the amount in ${acct.currency} that actually moved; there's no exchange rate to work it out.`);
      booked = b;
    }
    if (schedule.direction === "PAYMENT") assertSufficientFunds(acct, booked ?? amount);
    await postOccurrence(tx, schedule, { id: x.id, amount, date, booked });
    const updated = await tx.creditExecution.update({
      where: { id: x.id },
      data: { status: "CONFIRMED", confirmedAt: new Date(), amount, executedDate: date, failureReason: null },
    });
    // Paying a loan's last EMI closes it and ends its schedule.
    if (schedule.loanId && schedule.categoryId) await syncScheduledBudgets(tx, userId, [schedule.categoryId]);
    await audit(tx, userId, "occurrence", x.id, "occurrence.confirm", `${x.scheduledCredit.name}: ${schedule.direction === "INCOME" ? "received" : "paid"}`, {
      amount,
      date: isoDate(date),
      scheduledAmount: Number(x.amount),
    });
    return updated;
  });
}

/** Books a loan's next outstanding EMI. Used when the user logs the EMI as an
 * expense (Budget → "Log an expense", or the Expenses form with the loan's
 * category) instead of confirming it from the schedule: the payment is booked
 * against the earliest unpaid occurrence — a due one first, otherwise the next
 * upcoming one, paid early — so the loan's progress moves and the schedule
 * won't ask for that EMI again. A loan without a schedule records the payment
 * directly. */
export async function payNextLoanEmi(
  userId: string,
  input: { loanId: string; amount: number; date: Date; accountId: string; idempotencyKey?: string }
) {
  return db.$transaction(async (tx: Tx) => {
    const loan = await tx.loan.findFirst({ where: { id: input.loanId, userId } });
    if (!loan) throw new ValidationError("Loan not found.");
    if (input.idempotencyKey) {
      const seen = await tx.auditEvent.findFirst({
        where: { userId, entityType: "loan", entityId: loan.id, action: "loan.emi_logged", detail: { path: ["idempotencyKey"], equals: input.idempotencyKey } },
      });
      if (seen) return { loan, duplicate: true };
    }
    if (loan.status === "CLOSED") throw new ValidationError(`${loan.name} is already fully paid.`);
    const acct = await tx.account.findFirst({ where: { id: input.accountId, userId } });
    if (!acct) throw new ValidationError("Account not found.");
    assertSufficientFunds(acct, input.amount);
    const date = dateOnly(input.date);

    const s = await tx.scheduledCredit.findFirst({ where: { loanId: loan.id, isActive: true }, include: { overrides: true } });
    let executionId: string | null = null;
    if (s) {
      const due = await tx.creditExecution.findFirst({
        where: { scheduledCreditId: s.id, status: { in: ["PENDING", "FAILED"] } },
        orderBy: { occurrenceDate: "asc" },
      });
      if (due) {
        executionId = due.id;
      } else {
        // Next nominal occurrence with nothing stored against it yet.
        const end = s.endDate ? dateOnly(s.endDate) : null;
        const freq = s.frequency as Frequency;
        for (let k = 0; k < 1200; k++) {
          const nominal = nthOccurrence(s.startDate, freq, k, s.customIntervalDays);
          if (end && nominal > end) break;
          const stored = await tx.creditExecution.findUnique({
            where: { scheduledCreditId_occurrenceDate: { scheduledCreditId: s.id, occurrenceDate: nominal } },
          });
          if (stored) continue;
          const ov = s.overrides.find((o) => dateOnly(o.occurrenceDate).getTime() === nominal.getTime());
          const x = await tx.creditExecution.create({
            data: { scheduledCreditId: s.id, occurrenceDate: nominal, executedDate: ov?.date ? dateOnly(ov.date) : nominal, amount: ov?.amount ?? s.amount, status: "PENDING" },
          });
          executionId = x.id;
          break;
        }
      }
    }

    if (s && executionId) {
      await postOccurrence(tx, { ...s, receivingAccountId: acct.id }, { id: executionId, amount: input.amount, date });
      await tx.creditExecution.update({
        where: { id: executionId },
        data: { status: "CONFIRMED", confirmedAt: new Date(), amount: input.amount, executedDate: date, failureReason: null },
      });
      if (s.categoryId) await syncScheduledBudgets(tx, userId, [s.categoryId]);
    } else {
      await recordLoanPayment(userId, { loanId: loan.id, amount: input.amount, paidOn: date, fromAccountId: acct.id }, tx);
    }
    const paid = await tx.loanPayment.count({ where: { loanId: loan.id, reversedAt: null } });
    await audit(tx, userId, "loan", loan.id, "loan.emi_logged", `${loan.name}: EMI ${paid} of ${loan.installments} paid`, {
      amount: input.amount,
      date: isoDate(date),
      occurrenceId: executionId,
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    });
    return { loan, paidCount: paid, duplicate: false };
  });
}

/** Skips a due occurrence (PENDING/FAILED), or — given a schedule and a
 * nominal date — skips a future one ahead of time. No money moves. */
export async function skipOccurrence(
  userId: string,
  target: { executionId: string } | { scheduleId: string; occurrenceDate: Date },
  note?: string
) {
  return db.$transaction(async (tx: Tx) => {
    if ("executionId" in target) {
      const x = await loadExecution(tx, userId, target.executionId);
      if (x.status !== "PENDING" && x.status !== "FAILED") {
        throw new ValidationError("Only something not yet booked can be skipped.");
      }
      const updated = await tx.creditExecution.update({
        where: { id: x.id },
        data: { status: "SKIPPED", confirmedAt: new Date(), note: note ?? null },
      });
      await audit(tx, userId, "occurrence", x.id, "occurrence.skip", `${x.scheduledCredit.name}: skipped ${isoDate(x.executedDate)}`, { note: note ?? null });
      return updated;
    }
    const s = await tx.scheduledCredit.findFirst({ where: { id: target.scheduleId, userId }, include: { overrides: true } });
    if (!s) throw new ValidationError("Schedule not found.");
    const nominal = dateOnly(target.occurrenceDate);
    if (!isNominal(s, nominal)) throw new ValidationError("That date isn't part of this schedule.");
    const ov = s.overrides.find((o) => dateOnly(o.occurrenceDate).getTime() === nominal.getTime());
    const existing = await tx.creditExecution.findUnique({
      where: { scheduledCreditId_occurrenceDate: { scheduledCreditId: s.id, occurrenceDate: nominal } },
    });
    if (existing) {
      if (existing.status === "PENDING" || existing.status === "FAILED") return skipOccurrenceInTx(tx, userId, existing.id, s.name, note);
      throw new ValidationError("This one has already been dealt with.");
    }
    const x = await tx.creditExecution.create({
      data: {
        scheduledCreditId: s.id,
        occurrenceDate: nominal,
        executedDate: ov?.date ? dateOnly(ov.date) : nominal,
        amount: ov?.amount ?? s.amount,
        status: "SKIPPED",
        confirmedAt: new Date(),
        note: note ?? null,
      },
    });
    await audit(tx, userId, "occurrence", x.id, "occurrence.skip_ahead", `${s.name}: skipped upcoming ${isoDate(nominal)}`, { note: note ?? null });
    await syncScheduledBudgets(tx, userId, s.categoryId ? [s.categoryId] : []);
    return x;
  });
}

async function skipOccurrenceInTx(tx: Tx, userId: string, id: string, name: string, note?: string) {
  const updated = await tx.creditExecution.update({ where: { id }, data: { status: "SKIPPED", confirmedAt: new Date(), note: note ?? null } });
  await audit(tx, userId, "occurrence", id, "occurrence.skip", `${name}: skipped`, { note: note ?? null });
  return updated;
}

/** Brings back an occurrence that was skipped ahead of time (still in the
 * future, nothing booked). The skip itself remains in the audit trail. */
export async function restoreSkipped(userId: string, executionId: string) {
  return db.$transaction(async (tx: Tx) => {
    const x = await loadExecution(tx, userId, executionId);
    if (x.status !== "SKIPPED") throw new ValidationError("Only a skipped item can be brought back.");
    const today = await userTodayTx(tx, userId);
    if (dateOnly(x.executedDate) > today) {
      // Not due yet: drop the placeholder so it projects normally again.
      await tx.creditExecution.delete({ where: { id: x.id } });
    } else {
      await tx.creditExecution.update({ where: { id: x.id }, data: { status: "PENDING", confirmedAt: null } });
    }
    await audit(tx, userId, "occurrence", x.id, "occurrence.restore", `${x.scheduledCredit.name}: restored ${isoDate(x.executedDate)}`);
    await syncScheduledBudgets(tx, userId, x.scheduledCredit.categoryId ? [x.scheduledCredit.categoryId] : []);
    return { ok: true };
  });
}

export async function reverseOccurrence(userId: string, executionId: string, reason?: string) {
  return db.$transaction(async (tx: Tx) => {
    const x = await loadExecution(tx, userId, executionId);
    if (x.status !== "CONFIRMED") throw new ValidationError("Only something already booked can be reversed.");
    await reverseOccurrenceEntry(tx, x.id, `${x.scheduledCredit.name}: reversed${reason ? ` (${reason})` : ""}`);
    const updated = await tx.creditExecution.update({
      where: { id: x.id },
      data: { status: "REVERSED", reversedAt: new Date(), note: reason ?? x.note },
    });
    await audit(tx, userId, "occurrence", x.id, "occurrence.reverse", `${x.scheduledCredit.name}: reversed`, {
      amount: Number(x.amount),
      reason: reason ?? null,
    });
    return updated;
  });
}

async function userTodayTx(tx: Tx, userId: string) {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { timezone: true } });
  return todayIn(user?.timezone || "UTC");
}

function isNominal(s: ScheduledCredit, d: Date) {
  return occurrencesBetween(rule(s), d, d).some((n) => n.getTime() === d.getTime());
}

// ------------------------------------------------------------- overrides

/** Moves one occurrence to another date and/or changes its amount. The new
 * date must stay inside the occurrence's own period (after the previous
 * nominal date, before the next) so occurrences never swap order. */
export async function setOverride(
  userId: string,
  scheduleId: string,
  occurrenceDate: Date,
  input: { date?: Date | null; amount?: number | null }
) {
  return db.$transaction(async (tx: Tx) => {
    const s = await tx.scheduledCredit.findFirst({ where: { id: scheduleId, userId } });
    if (!s) throw new ValidationError("Schedule not found.");
    const nominal = dateOnly(occurrenceDate);
    if (!isNominal(s, nominal)) throw new ValidationError("That date isn't part of this schedule.");
    const booked = await tx.creditExecution.findUnique({
      where: { scheduledCreditId_occurrenceDate: { scheduledCreditId: s.id, occurrenceDate: nominal } },
    });
    if (booked) throw new ValidationError("This one is already due. Confirm it with the real date and amount instead.");

    const date = input.date ? dateOnly(input.date) : null;
    if (date) validateOverrideDate(s, nominal, date);
    if (input.amount != null && !(input.amount > 0)) throw new ValidationError("Amount must be greater than zero.");

    if (!date && input.amount == null) {
      await tx.scheduleOverride.deleteMany({ where: { scheduledCreditId: s.id, occurrenceDate: nominal } });
    } else {
      await tx.scheduleOverride.upsert({
        where: { scheduledCreditId_occurrenceDate: { scheduledCreditId: s.id, occurrenceDate: nominal } },
        update: { date, amount: input.amount ?? null },
        create: { scheduledCreditId: s.id, occurrenceDate: nominal, date, amount: input.amount ?? null },
      });
    }
    await audit(tx, userId, "schedule", s.id, "schedule.override", `${s.name}: occurrence of ${isoDate(nominal)} adjusted`, {
      occurrenceDate: isoDate(nominal),
      date: date ? isoDate(date) : null,
      amount: input.amount ?? null,
    });
    await syncScheduledBudgets(tx, userId, s.categoryId ? [s.categoryId] : []);
    return { ok: true };
  });
}

export function validateOverrideDate(s: Pick<ScheduledCredit, "startDate" | "frequency" | "customIntervalDays">, nominal: Date, date: Date) {
  if (s.frequency === "ONE_TIME") return;
  const { prev, next } = neighbours({ startDate: s.startDate, frequency: s.frequency as Frequency, customIntervalDays: s.customIntervalDays }, nominal);
  if ((prev && date <= prev) || (next && date >= next)) {
    throw new ValidationError(
      `Keep this date between ${prev ? isoDate(prev) : "the start"} and ${next ? isoDate(next) : "the end"}. To go further, move the next one instead.`
    );
  }
}

// ------------------------------------------------------------- schedule CRUD

export interface ScheduleInput {
  direction: "INCOME" | "PAYMENT";
  kind: string;
  name: string;
  amount: number;
  /** Optional for a payment (not a loan's EMIs or income). */
  accountId?: string | null;
  categoryId?: string | null;
  frequency: Frequency;
  customIntervalDays?: number | null;
  startDate: Date;
  endDate?: Date | null;
  requiresConfirmation: boolean;
  notes?: string | null;
  loanId?: string | null;
  /** The amount's currency; defaults to the account's. Another currency is
   * converted into the account's when each occurrence is booked. */
  currency?: string;
  /** Per-occurrence date/amount changes, keyed by nominal date. */
  overrides?: { occurrenceDate: Date; date?: Date | null; amount?: number | null }[];
}

export async function createSchedule(userId: string, input: ScheduleInput, txIn?: Tx) {
  const run = async (tx: Tx) => {
    // A payment can be set up before deciding which account pays it.
    if (!input.accountId && (input.direction === "INCOME" || input.loanId)) throw new ValidationError("Choose the account it's paid into.");
    const account = input.accountId ? await tx.account.findFirst({ where: { id: input.accountId, userId } }) : null;
    if (input.accountId && !account) throw new ValidationError("Account not found.");
    if (account?.status === "CLOSED") throw new ValidationError(`${account.name} is closed.`);
    if (input.endDate && input.endDate < input.startDate) throw new ValidationError("End date is before the start date.");
    const currency =
      input.currency ?? account?.currency ?? (await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { baseCurrency: true } })).baseCurrency;
    if (input.loanId && account && currency !== account.currency) throw new ValidationError(`The loan's EMIs have to be paid from a ${currency} account.`);
    let categoryId: string | null = null;
    if (input.direction === "PAYMENT") {
      if (!input.categoryId) throw new ValidationError("Choose a budget category for this payment.");
      const cat = await tx.category.findFirst({ where: { id: input.categoryId, userId } });
      if (!cat) throw new ValidationError("Category not found.");
      categoryId = cat.id;
    }
    const start = dateOnly(input.startDate);
    const s = await tx.scheduledCredit.create({
      data: {
        userId,
        direction: input.direction,
        kind: input.kind,
        name: input.name,
        notes: input.notes ?? null,
        amount: input.amount,
        currency,
        receivingAccountId: account?.id ?? null,
        categoryId,
        loanId: input.loanId ?? null,
        frequency: input.frequency,
        customIntervalDays: input.frequency === "CUSTOM" ? input.customIntervalDays ?? 30 : null,
        startDate: start,
        endDate: input.endDate ? dateOnly(input.endDate) : null,
        nextExecutionDate: start,
        requiresConfirmation: input.requiresConfirmation,
      },
    });
    for (const o of input.overrides ?? []) {
      const nominal = dateOnly(o.occurrenceDate);
      if (!isNominal(s, nominal)) continue;
      const date = o.date ? dateOnly(o.date) : null;
      if (date) validateOverrideDate(s, nominal, date);
      if (!date && o.amount == null) continue;
      if (date && date.getTime() === nominal.getTime() && o.amount == null) continue;
      await tx.scheduleOverride.create({
        data: { scheduledCreditId: s.id, occurrenceDate: nominal, date, amount: o.amount ?? null },
      });
    }
    await audit(tx, userId, "schedule", s.id, "schedule.create", `Scheduled ${s.name}`, {
      direction: s.direction,
      amount: input.amount,
      frequency: input.frequency,
      start: isoDate(start),
    });
    if (categoryId) await syncScheduledBudgets(tx, userId, [categoryId]);
    return s;
  };
  return txIn ? run(txIn) : db.$transaction(run);
}

export interface ScheduleChanges {
  name?: string;
  kind?: string;
  amount?: number;
  /** Applies to occurrences not booked yet. */
  currency?: string;
  /** null clears it (payments only): each one is then paid from the budget line's account. */
  accountId?: string | null;
  categoryId?: string | null;
  requiresConfirmation?: boolean;
  endDate?: Date | null;
  notes?: string | null;
  isActive?: boolean;
  /** Re-anchors the rule from this (future) date: frequency/start changes
   * apply only from here on; booked history is untouched. */
  frequency?: Frequency;
  customIntervalDays?: number | null;
  startDate?: Date;
}

/** Edits a schedule. Changes apply to occurrences that haven't come due yet;
 * everything already booked/skipped stays exactly as it was. The before/after
 * is written to the audit trail and budgets for coming months re-sync. */
export async function updateSchedule(userId: string, scheduleId: string, changes: ScheduleChanges) {
  return db.$transaction(async (tx: Tx) => {
    const s = await tx.scheduledCredit.findFirst({ where: { id: scheduleId, userId } });
    if (!s) throw new ValidationError("Schedule not found.");
    const data: Prisma.ScheduledCreditUpdateInput = {};
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const track = (k: string, from: unknown, to: unknown) => {
      before[k] = from;
      after[k] = to;
    };

    if (changes.name !== undefined && changes.name !== s.name) { data.name = changes.name; track("name", s.name, changes.name); }
    if (changes.kind !== undefined && changes.kind !== s.kind) { data.kind = changes.kind; track("kind", s.kind, changes.kind); }
    if (changes.notes !== undefined) data.notes = changes.notes;
    if (changes.amount !== undefined && changes.amount !== Number(s.amount)) {
      if (!(changes.amount > 0)) throw new ValidationError("Amount must be greater than zero.");
      data.amount = changes.amount;
      track("amount", Number(s.amount), changes.amount);
      // Ones already due but not yet confirmed take the new amount too,
      // unless that date's amount was set by hand.
      const due = await tx.creditExecution.findMany({ where: { scheduledCreditId: s.id, status: { in: ["PENDING", "FAILED"] } } });
      const fixed = new Set(
        (await tx.scheduleOverride.findMany({ where: { scheduledCreditId: s.id, amount: { not: null } }, select: { occurrenceDate: true } })).map((o) => dateOnly(o.occurrenceDate).getTime())
      );
      for (const x of due) {
        if (x.occurrenceDate && fixed.has(dateOnly(x.occurrenceDate).getTime())) continue;
        await tx.creditExecution.update({ where: { id: x.id }, data: { amount: changes.amount } });
      }
    }
    if (changes.currency !== undefined && changes.currency !== s.currency) {
      if (s.loanId) throw new ValidationError("A loan's EMIs stay in the loan's currency.");
      data.currency = changes.currency;
      track("currency", s.currency, changes.currency);
      // Due-but-unconfirmed ones were set in the old currency: re-express them.
      const due = await tx.creditExecution.findMany({ where: { scheduledCreditId: s.id, status: { in: ["PENDING", "FAILED"] } } });
      for (const x of due) {
        const v = await convertForAccount(tx, userId, Number(x.amount), s.currency, changes.currency);
        if (v != null) await tx.creditExecution.update({ where: { id: x.id }, data: { amount: v } });
      }
    }
    if (changes.requiresConfirmation !== undefined && changes.requiresConfirmation !== s.requiresConfirmation) {
      data.requiresConfirmation = changes.requiresConfirmation;
      track("requiresConfirmation", s.requiresConfirmation, changes.requiresConfirmation);
    }
    if (changes.accountId && changes.accountId !== s.receivingAccountId) {
      const account = await tx.account.findFirst({ where: { id: changes.accountId, userId } });
      if (!account || account.status === "CLOSED") throw new ValidationError("Choose an open account.");
      if (s.loanId && account.currency !== s.currency) throw new ValidationError(`This loan is in ${s.currency}; ${account.name} is in ${account.currency}.`);
      data.receivingAccount = { connect: { id: account.id } };
      track("accountId", s.receivingAccountId, account.id);
    } else if (changes.accountId === null && s.receivingAccountId) {
      if (s.direction === "INCOME" || s.loanId) throw new ValidationError("This one needs an account.");
      data.receivingAccount = { disconnect: true };
      track("accountId", s.receivingAccountId, null);
    }
    const oldCategory = s.categoryId;
    if (changes.categoryId !== undefined && changes.categoryId !== s.categoryId && s.direction === "PAYMENT") {
      if (!changes.categoryId) throw new ValidationError("A scheduled payment needs a budget category.");
      const cat = await tx.category.findFirst({ where: { id: changes.categoryId, userId } });
      if (!cat) throw new ValidationError("Category not found.");
      data.category = { connect: { id: cat.id } };
      track("categoryId", s.categoryId, cat.id);
    }
    if (changes.endDate !== undefined) {
      const end = changes.endDate ? dateOnly(changes.endDate) : null;
      if (end && end < dateOnly(s.startDate)) throw new ValidationError("End date is before the start date.");
      data.endDate = end;
      track("endDate", s.endDate ? isoDate(s.endDate) : null, end ? isoDate(end) : null);
    }
    if (changes.isActive !== undefined && changes.isActive !== s.isActive) {
      data.isActive = changes.isActive;
      data.cancelledAt = changes.isActive ? null : new Date();
      track("isActive", s.isActive, changes.isActive);
    }
    const reanchor =
      (changes.frequency && changes.frequency !== s.frequency) ||
      (changes.startDate && dateOnly(changes.startDate).getTime() !== dateOnly(s.nextExecutionDate).getTime()) ||
      (changes.customIntervalDays !== undefined && changes.customIntervalDays !== s.customIntervalDays && (changes.frequency ?? s.frequency) === "CUSTOM");
    if (reanchor) {
      const today = await userTodayTx(tx, userId);
      const start = dateOnly(changes.startDate ?? s.nextExecutionDate);
      if (start < today) throw new ValidationError("A new pattern has to start today or later. Past ones stay as they were.");
      const freq = changes.frequency ?? (s.frequency as Frequency);
      data.frequency = freq;
      data.customIntervalDays = freq === "CUSTOM" ? changes.customIntervalDays ?? s.customIntervalDays ?? 30 : null;
      data.startDate = start;
      data.nextExecutionDate = start;
      // Overrides belonged to the old pattern's future dates.
      await tx.scheduleOverride.deleteMany({ where: { scheduledCreditId: s.id, occurrenceDate: { gte: today } } });
      track("pattern", { frequency: s.frequency, next: isoDate(s.nextExecutionDate) }, { frequency: freq, next: isoDate(start) });
    }

    const updated = await tx.scheduledCredit.update({ where: { id: s.id }, data });
    if (Object.keys(after).length) {
      await audit(tx, userId, "schedule", s.id, "schedule.update", `Updated ${updated.name}`, { before, after } as Prisma.InputJsonValue);
    }
    const cats = [oldCategory, updated.categoryId].filter((c): c is string => !!c);
    if (cats.length) await syncScheduledBudgets(tx, userId, [...new Set(cats)]);
    return updated;
  });
}

/** Removes a schedule. Nothing paid yet: it's deleted outright, with any
 * occurrences that were merely due or skipped. Payments made: an open-ended
 * one is ended (nothing more is owed); one with an end date and payments
 * still to come has to be paid off instead (payOffSchedule). A loan's EMI
 * schedule is managed through the loan. */
export async function deleteOrEndSchedule(userId: string, scheduleId: string) {
  return db.$transaction(async (tx: Tx) => {
    const s = await tx.scheduledCredit.findFirst({ where: { id: scheduleId, userId }, include: { overrides: true, executions: true } });
    if (!s) throw new ValidationError("Schedule not found.");
    if (s.loanId) throw new ValidationError("This is a loan's EMI schedule. Pay off or delete the loan instead.");
    const booked = s.executions.some((x) => x.status === "CONFIRMED" || x.status === "REVERSED");
    if (!booked) {
      await tx.scheduledCredit.delete({ where: { id: s.id } });
      await audit(tx, userId, "schedule", s.id, "schedule.delete", `Deleted ${s.name} (nothing paid)`);
      if (s.categoryId) await syncScheduledBudgets(tx, userId, [s.categoryId]);
      return { deleted: true };
    }
    if (s.endDate && (await remainingOccurrences(tx, s)).length > 0) {
      throw new ValidationError(`${s.name} has payments made and more still to come. Pay off what's left to close it.`);
    }
    await tx.scheduledCredit.update({ where: { id: s.id }, data: { isActive: false, cancelledAt: new Date() } });
    await audit(tx, userId, "schedule", s.id, "schedule.end", `Ended ${s.name}`);
    if (s.categoryId) await syncScheduledBudgets(tx, userId, [s.categoryId]);
    return { deleted: false };
  });
}

/** Occurrences of a schedule still to be paid: those already due but not
 * confirmed, then every upcoming one up to the end date. */
async function remainingOccurrences(tx: Tx, s: ScheduleWithRelations) {
  const today = await userTodayTx(tx, s.userId);
  const due = s.executions
    .filter((x) => x.status === "PENDING" || x.status === "FAILED")
    .map((x) => ({ nominal: dateOnly(x.occurrenceDate ?? x.executedDate), amount: Number(x.amount), executionId: x.id as string | null }));
  if (!s.endDate || !s.isActive) return due;
  const upcoming = projectSchedule(s, today, dateOnly(s.endDate))
    .filter((o) => o.status === "SCHEDULED")
    .map((o) => ({ nominal: dateOnly(new Date(o.occurrenceDate)), amount: o.amount, executionId: null as string | null }));
  return [...due, ...upcoming];
}

/** What's left on a schedule with an end date, and the total. */
export async function scheduleRemaining(userId: string, scheduleId: string) {
  const s = await db.scheduledCredit.findFirst({ where: { id: scheduleId, userId }, include: { overrides: true, executions: true } });
  if (!s) throw new ValidationError("Schedule not found.");
  const rest = await db.$transaction((tx: Tx) => remainingOccurrences(tx, s));
  return { count: rest.length, total: Math.round(rest.reduce((t, o) => t + o.amount, 0) * 100) / 100, currency: s.currency };
}

/** Pays everything left on a schedule in one go (each remaining payment is
 * booked on `date` from the account) and ends it. */
export async function payOffSchedule(userId: string, scheduleId: string, input: { accountId?: string; date: Date }) {
  return db.$transaction(async (tx: Tx) => {
    const s = await tx.scheduledCredit.findFirst({ where: { id: scheduleId, userId }, include: { overrides: true, executions: true } });
    if (!s) throw new ValidationError("Schedule not found.");
    if (s.loanId) throw new ValidationError("This is a loan's EMI schedule. Pay off the loan instead.");
    const date = dateOnly(input.date);
    const rest = await remainingOccurrences(tx, s);
    if (rest.length === 0) throw new ValidationError("Nothing is left to pay on this one.");
    const accountId = input.accountId ?? (await accountForOccurrence(tx, s, date));
    if (!accountId) throw new ValidationError(s.direction === "INCOME" ? "Choose the account it arrived in." : "Choose the account it was paid from.");
    const account = await tx.account.findFirst({ where: { id: accountId, userId } });
    if (!account) throw new ValidationError("Account not found.");
    const sched = { ...s, receivingAccountId: account.id };
    let total = 0;
    const bookings: { id: string; amount: number; booked?: number }[] = [];
    for (const o of rest) {
      const id =
        o.executionId ??
        (await tx.creditExecution.create({
          data: { scheduledCreditId: s.id, occurrenceDate: o.nominal, executedDate: date, amount: o.amount, status: "PENDING" },
        })).id;
      let booked: number | undefined;
      if (account.currency !== s.currency) {
        const b = await convertForAccount(tx, userId, o.amount, s.currency, account.currency);
        if (b == null) throw new ValidationError(`No ${s.currency} → ${account.currency} exchange rate to convert with.`);
        booked = b;
      }
      total += booked ?? o.amount;
      bookings.push({ id, amount: o.amount, booked });
    }
    if (s.direction === "PAYMENT") assertSufficientFunds(account, total);
    for (const b of bookings) {
      await postOccurrence(tx, sched, { id: b.id, amount: b.amount, date, booked: b.booked });
      await tx.creditExecution.update({ where: { id: b.id }, data: { status: "CONFIRMED", confirmedAt: new Date(), executedDate: date, failureReason: null } });
    }
    await tx.scheduledCredit.update({ where: { id: s.id }, data: { isActive: false, cancelledAt: new Date() } });
    await audit(tx, userId, "schedule", s.id, "schedule.payoff", `Paid off ${s.name}`, { payments: bookings.length, total, accountId: account.id });
    if (s.categoryId) await syncScheduledBudgets(tx, userId, [s.categoryId]);
    return { payments: bookings.length, total: Math.round(total * 100) / 100, currency: account.currency };
  });
}

// ------------------------------------------------------------- budget sync

/**
 * Keeps budget allocations that were sized from scheduled payments in step
 * with the schedules. For the current month and every later month that
 * already has a plan: a category with scheduled payments but no allocation
 * gets one (source SCHEDULE); an existing SCHEDULE allocation is re-sized to
 * the scheduled total. Allocations the user set by hand (MANUAL/RECURRING)
 * are never overwritten.
 */
export async function syncScheduledBudgets(tx: Tx, userId: string, categoryIds?: string[]) {
  const today = await userTodayTx(tx, userId);
  const currentMonth = monthKey(today);
  const plans = await tx.budgetPlan.findMany({ where: { userId, month: { gte: currentMonth } } });
  if (!plans.length) return;
  const schedules = await tx.scheduledCredit.findMany({
    where: { userId, direction: "PAYMENT", ...(categoryIds?.length ? { categoryId: { in: categoryIds } } : {}) },
    include: { overrides: true, executions: true },
  });
  const cats = new Set<string>(categoryIds ?? schedules.map((s) => s.categoryId).filter((c): c is string => !!c));
  const owner = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { baseCurrency: true } });
  const fx = await createFxConverter(userId, owner.baseCurrency, { refresh: false, client: tx });
  for (const plan of plans) {
    const { start, end } = monthRange(plan.month);
    const last = new Date(end.getTime() - 86_400_000);
    const committed = new Map<string, { amount: number; accountId: string | null }>();
    for (const s of schedules) {
      if (!s.categoryId) continue;
      for (const o of projectSchedule(s, start, last)) {
        if (o.status === "SKIPPED" || o.status === "REVERSED") continue;
        const c = committed.get(s.categoryId) ?? { amount: 0, accountId: s.receivingAccountId };
        // A rent paid in INR still sizes a GBP budget line — converted at
        // today's rate (display/planning only; the payment stays in INR).
        c.amount += fx.convertTo(o.amount, o.currency, plan.currency) ?? o.amount;
        committed.set(s.categoryId, c);
      }
    }
    for (const categoryId of cats) {
      const c = committed.get(categoryId);
      const existing = await tx.budgetCategoryAllocation.findUnique({
        where: { budgetPlanId_categoryId: { budgetPlanId: plan.id, categoryId } },
      });
      if (!existing) {
        if (!c || c.amount <= 0) continue;
        const max = await tx.budgetCategoryAllocation.aggregate({ where: { budgetPlanId: plan.id }, _max: { sortOrder: true } });
        await tx.budgetCategoryAllocation.create({
          data: {
            budgetPlanId: plan.id,
            categoryId,
            budgetAmount: Math.round(c.amount * 100) / 100,
            accountId: c.accountId,
            source: "SCHEDULE",
            sortOrder: (max._max.sortOrder ?? -1) + 1,
          },
        });
      } else if (existing.source === "SCHEDULE") {
        const amount = Math.round((c?.amount ?? 0) * 100) / 100;
        if (Number(existing.budgetAmount) !== amount) {
          await tx.budgetCategoryAllocation.update({ where: { id: existing.id }, data: { budgetAmount: amount } });
          await tx.budgetAdjustment.create({
            data: {
              budgetCategoryAllocationId: existing.id,
              oldAmount: existing.budgetAmount,
              newAmount: amount,
              note: "Synced from scheduled payments",
            },
          });
        }
      }
    }
  }
}
