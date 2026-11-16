import { db } from "@/lib/db";
import { ValidationError, roundMoney } from "@/lib/validate";
import { audit, isLiabilityAccount, type Tx } from "@/lib/ledger";
import { loadOccurrences, userToday, type Occurrence } from "@/lib/schedules";
import { createFxConverter, type FxConverter } from "@/lib/fx";
import { addDaysUTC, isoDate, monthKey, monthRange, shiftMonth } from "@/lib/dates";
import { budgetGroups, rootOf } from "@/lib/budget-tree";

/**
 * Where a month's budget money comes from. Planning only: nothing in this
 * module creates a ledger entry, moves money, or changes a balance, a
 * receivable or a loan.
 *
 * A plan draws on sources (BudgetSource), each one of:
 *  - RECEIVABLE: one occurrence of an income schedule (this month's stipend).
 *    It can't be claimed beyond its amount, across every month's plan.
 *  - ACCOUNT: part of an account's balance. Across the plans for this month
 *    and later, an account can't be committed beyond its balance, less any
 *    received income those plans already claim that was paid into it (that
 *    money is in the balance already, so it isn't counted twice).
 * Each budget line takes funding (BudgetFunding) from those sources, up to
 * the source's amount; a parent and its subcategories share one envelope,
 * so their funding together can't exceed it.
 *
 * Caps are checked inside a transaction holding a per-user lock, so two
 * saves can't both claim the same money. Amounts are in the plan's currency;
 * sources in another currency are compared at today's rate.
 */

export type SourceKind = "RECEIVABLE" | "ACCOUNT";

/** What the user picks as a source. */
export type SourceRef = { sourceId: string } | { receivable: { scheduleId: string; occurrenceDate: string } } | { accountId: string };

export const receivableKey = (scheduleId: string, occurrenceDate: string) => `R:${scheduleId}:${occurrenceDate}`;
export const accountKey = (accountId: string) => `A:${accountId}`;
const occKey = (scheduleId: string, occurrenceDate: string) => `${scheduleId}:${occurrenceDate}`;

/** Lifecycle of a receivable source, as the plan shows it. */
export type ReceivableState = "expected" | "due" | "overdue" | "received" | "failed" | "cancelled" | "gone";

export function receivableState(o: Occurrence | undefined, today: string): ReceivableState {
  if (!o) return "gone";
  if (o.status === "CONFIRMED") return "received";
  if (o.status === "SKIPPED" || o.status === "REVERSED") return "cancelled";
  if (o.status === "FAILED") return "failed";
  if (o.date < today) return "overdue";
  if (o.date === today || o.status === "PENDING") return "due";
  return "expected";
}

const BACKS: Record<ReceivableState, boolean> = { expected: true, due: true, overdue: true, received: true, failed: true, cancelled: false, gone: false };

async function lockBudget(tx: Tx, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"budget-funding:" + userId}))`;
}

/** The income occurrences a plan can draw on or already refers to: last
 * month's (a stipend paid at month end often funds the next month) through
 * this month's, plus any further dates its sources name. */
async function receivableOccurrences(userId: string, month: string, extraDates: string[] = []) {
  const from = monthRange(shiftMonth(month, -1)).start;
  let to = new Date(monthRange(month).end.getTime() - 86_400_000);
  let start = from;
  for (const d of extraDates) {
    const t = new Date(d);
    if (t < start) start = t;
    if (t > to) to = t;
  }
  // Wide margins: occurrences are found by nominal date, which an override
  // can move a little within its period.
  const occ = await loadOccurrences(userId, addDaysUTC(start, -40), addDaysUTC(to, 40), { direction: "INCOME" });
  return new Map(occ.map((o) => [occKey(o.scheduleId, o.occurrenceDate), o]));
}

interface Ctx {
  userId: string;
  planId: string;
  month: string;
  currency: string;
  today: string;
  currentMonth: string;
  fx: FxConverter;
}

const conv = (fx: FxConverter, amount: number, from: string, to: string) => (from === to ? amount : (fx.convertTo(amount, from, to) ?? amount));

/** Every receivable claim and account commitment across the user's plans. */
async function commitments(client: Tx | typeof db, userId: string) {
  return client.budgetSource.findMany({
    where: { budgetPlan: { userId } },
    select: { id: true, kind: true, budgetPlanId: true, scheduledCreditId: true, occurrenceDate: true, accountId: true, amount: true, budgetPlan: { select: { month: true, currency: true } } },
  });
}
type Commitment = Awaited<ReturnType<typeof commitments>>[number];

/** How much of a receivable occurrence is still unclaimed by other plans, in `ctx.currency`. */
function receivableRoom(ctx: Ctx, o: Occurrence | undefined, all: Commitment[]) {
  if (!o || !BACKS[receivableState(o, ctx.today)]) return 0;
  const claimed = all
    .filter((c) => c.kind === "RECEIVABLE" && c.budgetPlanId !== ctx.planId && c.scheduledCreditId === o.scheduleId && c.occurrenceDate && isoDate(c.occurrenceDate) === o.occurrenceDate)
    .reduce((s, c) => s + conv(ctx.fx, Number(c.amount), c.budgetPlan.currency, o.currency), 0);
  return Math.max(0, roundMoney(conv(ctx.fx, o.amount - claimed, o.currency, ctx.currency)));
}

/** How much of an account's balance is free for this plan, in `ctx.currency`:
 * the balance, less what other plans for this month or later set aside from
 * it, less received income any of those plans (this one included) claim
 * that was paid into it. */
function accountRoom(
  ctx: Ctx,
  account: { id: string; currency: string; currentBalance: unknown; status: string; accountType: string },
  all: Commitment[],
  occurrences: Map<string, Occurrence>
) {
  if (account.status === "CLOSED" || isLiabilityAccount(account.accountType)) return 0;
  let committed = 0;
  // Received income claimed by open plans, per occurrence (its own currency).
  const claimedReceived = new Map<string, number>();
  for (const c of all) {
    if (c.budgetPlan.month < ctx.currentMonth) continue;
    if (c.kind === "ACCOUNT" && c.accountId === account.id && c.budgetPlanId !== ctx.planId) {
      committed += conv(ctx.fx, Number(c.amount), c.budgetPlan.currency, account.currency);
    }
    if (c.kind === "RECEIVABLE" && c.scheduledCreditId && c.occurrenceDate) {
      const k = occKey(c.scheduledCreditId, isoDate(c.occurrenceDate));
      const o = occurrences.get(k);
      if (o && o.status === "CONFIRMED" && o.accountId === account.id) claimedReceived.set(k, (claimedReceived.get(k) ?? 0) + conv(ctx.fx, Number(c.amount), c.budgetPlan.currency, o.currency));
    }
  }
  // Only what actually arrived is in the balance: a stipend received short
  // doesn't tie up more of the account than it added.
  for (const [k, claimed] of claimedReceived) {
    const o = occurrences.get(k)!;
    committed += conv(ctx.fx, Math.min(claimed, o.amount), o.currency, account.currency);
  }
  return Math.max(0, roundMoney(conv(ctx.fx, Number(account.currentBalance) - committed, account.currency, ctx.currency)));
}

async function context(userId: string, planId: string) {
  const plan = await db.budgetPlan.findFirst({ where: { id: planId, userId } });
  if (!plan) throw new ValidationError("Budget not found.");
  const owner = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { baseCurrency: true } });
  const today = await userToday(userId);
  // Rates are fetched here, outside the transaction (never refresh inside one).
  const fx = await createFxConverter(userId, owner.baseCurrency);
  return { plan, ctx: { userId, planId, month: plan.month, currency: plan.currency, today: isoDate(today), currentMonth: monthKey(today), fx } satisfies Ctx };
}

/** Finds the plan's source for `ref`, or works out the one to create. */
async function resolveSource(tx: Tx, ctx: Ctx, ref: SourceRef, occurrences: Map<string, Occurrence>) {
  if ("sourceId" in ref) {
    const s = await tx.budgetSource.findFirst({ where: { id: ref.sourceId, budgetPlanId: ctx.planId } });
    if (!s) throw new ValidationError("That money source isn't part of this month's budget any more.");
    return { existing: s, key: s.sourceKey };
  }
  if ("receivable" in ref) {
    const { scheduleId, occurrenceDate } = ref.receivable;
    const key = receivableKey(scheduleId, occurrenceDate);
    const existing = await tx.budgetSource.findUnique({ where: { budgetPlanId_sourceKey: { budgetPlanId: ctx.planId, sourceKey: key } } });
    if (existing) return { existing, key };
    const o = occurrences.get(occKey(scheduleId, occurrenceDate));
    const sched = await tx.scheduledCredit.findFirst({ where: { id: scheduleId, userId: ctx.userId, direction: "INCOME" }, select: { name: true } });
    if (!o || !sched) throw new ValidationError("That income isn't scheduled for this period any more.");
    return { existing: null, key, create: { kind: "RECEIVABLE" as const, scheduledCreditId: scheduleId, occurrenceDate: new Date(occurrenceDate), accountId: null, label: `${sched.name} (${shortDate(o.date)})` } };
  }
  const key = accountKey(ref.accountId);
  const existing = await tx.budgetSource.findUnique({ where: { budgetPlanId_sourceKey: { budgetPlanId: ctx.planId, sourceKey: key } } });
  if (existing) return { existing, key };
  const account = await tx.account.findFirst({ where: { id: ref.accountId, userId: ctx.userId } });
  if (!account || account.status === "CLOSED") throw new ValidationError("Choose an open account.");
  if (isLiabilityAccount(account.accountType)) throw new ValidationError(`${account.name} is a card or loan account: it holds what you owe, not money to budget.`);
  return { existing: null, key, create: { kind: "ACCOUNT" as const, scheduledCreditId: null, occurrenceDate: null, accountId: account.id, label: account.name } };
}

/** The most a source can be set to in this plan (plan currency). */
async function sourceCeiling(tx: Tx, ctx: Ctx, s: { kind: string; scheduledCreditId: string | null; occurrenceDate: Date | null; accountId: string | null }, occurrences: Map<string, Occurrence>, all: Commitment[]) {
  if (s.kind === "RECEIVABLE") {
    if (!s.scheduledCreditId || !s.occurrenceDate) return 0;
    return receivableRoom(ctx, occurrences.get(occKey(s.scheduledCreditId, isoDate(s.occurrenceDate))), all);
  }
  if (!s.accountId) return 0;
  const account = await tx.account.findUnique({ where: { id: s.accountId } });
  return account ? accountRoom(ctx, account, all, occurrences) : 0;
}

/** Adds a source to a month's money (or changes how much of it the month takes). */
export async function setSource(userId: string, month: string, ref: Exclude<SourceRef, { sourceId: string }>, amount?: number) {
  const plan = await db.budgetPlan.findUnique({ where: { userId_month: { userId, month } } });
  if (!plan) throw new ValidationError("Open this month's budget first.");
  const { ctx } = await context(userId, plan.id);
  const extra = "receivable" in ref ? [ref.receivable.occurrenceDate] : [];
  const occurrences = await receivableOccurrences(userId, month, extra.concat(await sourceDates(plan.id, userId, ctx.currentMonth)));
  return db.$transaction(async (tx: Tx) => {
    await lockBudget(tx, userId);
    const all = await commitments(tx, userId);
    const r = await resolveSource(tx, ctx, ref, occurrences);
    const shape = r.existing ?? r.create!;
    const ceiling = await sourceCeiling(tx, ctx, shape, occurrences, all);
    const want = amount ?? (shape.kind === "RECEIVABLE" ? ceiling : 0);
    if (!(want > 0)) throw new ValidationError(shape.kind === "RECEIVABLE" ? "Nothing of that income is left to budget: other months already use all of it." : "Enter how much of the balance this month uses.");
    if (want > ceiling + 0.005) throw new ValidationError(roomMessage(shape.kind, r.existing?.label ?? r.create!.label, ceiling, ctx.currency));
    const drawn = r.existing ? await drawnFrom(tx, r.existing.id) : 0;
    if (want + 0.005 < drawn) throw new ValidationError(`Budget lines already use ${money(drawn, ctx.currency)} of ${r.existing!.label}. Reduce their funding first.`);
    const source = r.existing
      ? await tx.budgetSource.update({ where: { id: r.existing.id }, data: { amount: roundMoney(want) } })
      : await tx.budgetSource.create({ data: { budgetPlanId: plan.id, sourceKey: r.key, ...r.create!, amount: roundMoney(want), sortOrder: await tx.budgetSource.count({ where: { budgetPlanId: plan.id } }) } });
    await audit(tx, userId, "budget", source.id, "budget.source", `${source.label} set to ${money(want, ctx.currency)} for ${month}`, { kind: source.kind, amount: want });
    return source;
  });
}

/** Removes a source from its month; lines lose the funding it gave them. */
export async function removeSource(userId: string, sourceId: string) {
  return db.$transaction(async (tx: Tx) => {
    await lockBudget(tx, userId);
    const s = await tx.budgetSource.findFirst({ where: { id: sourceId, budgetPlan: { userId } }, include: { funding: true, budgetPlan: true } });
    if (!s) throw new ValidationError("Money source not found.");
    await tx.budgetSource.delete({ where: { id: s.id } });
    await audit(tx, userId, "budget", s.id, "budget.source_remove", `${s.label} removed from ${s.budgetPlan.month}`, { linesUnfunded: s.funding.length });
    return { linesUnfunded: s.funding.length };
  });
}

/** Occurrence dates every plan for this month or later (and `planId`) refers
 * to: account room depends on which of them were received, and where. */
async function sourceDates(planId: string, userId: string, currentMonth: string) {
  const rows = await db.budgetSource.findMany({
    where: { occurrenceDate: { not: null }, OR: [{ budgetPlanId: planId }, { budgetPlan: { userId, month: { gte: currentMonth } } }] },
    select: { occurrenceDate: true },
  });
  return rows.map((r) => isoDate(r.occurrenceDate!));
}

async function drawnFrom(tx: Tx, sourceId: string, exceptAllocationId?: string) {
  const r = await tx.budgetFunding.aggregate({ where: { sourceId, ...(exceptAllocationId ? { allocationId: { not: exceptAllocationId } } : {}) }, _sum: { amount: true } });
  return Number(r._sum.amount ?? 0);
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const STATE_WORD: Record<ReceivableState, string> = { expected: "expected", due: "due", overdue: "overdue since", received: "received", failed: "due", cancelled: "cancelled", gone: "was due" };
const money = (n: number, c: string) => new Intl.NumberFormat("en-GB", { style: "currency", currency: c, maximumFractionDigits: 2 }).format(n);
const roomMessage = (kind: string, label: string, room: number, c: string) =>
  kind === "RECEIVABLE"
    ? room > 0
      ? `Only ${money(room, c)} of ${label} is left to budget; other months use the rest.`
      : `All of ${label} is already budgeted in other months.`
    : room > 0
      ? `Only ${money(room, c)} of ${label}'s balance is free; the rest is set aside in budgets or already counted as received income.`
      : `None of ${label}'s balance is free: it's set aside in budgets or already counted as received income.`;

/** What applying funding needs from outside the transaction: today's rates
 * and the income occurrences involved (both may hit the network/DB at length). */
export async function prepareFunding(userId: string, planId: string, rows: SourceRef[] = []) {
  const { ctx } = await context(userId, planId);
  const extra = rows.flatMap((r) => ("receivable" in r ? [r.receivable.occurrenceDate] : []));
  const occurrences = await receivableOccurrences(userId, ctx.month, extra.concat(await sourceDates(planId, userId, ctx.currentMonth)));
  return { ctx, occurrences };
}
export type FundingPrep = Awaited<ReturnType<typeof prepareFunding>>;

/** Replaces a line's funding: standalone, in its own transaction. */
export async function setLineFunding(userId: string, allocationId: string, rows: (SourceRef & { amount: number })[]) {
  const line = await db.budgetCategoryAllocation.findFirst({ where: { id: allocationId, budgetPlan: { userId } }, select: { budgetPlanId: true } });
  if (!line) throw new ValidationError("Budget line not found.");
  const prep = await prepareFunding(userId, line.budgetPlanId, rows);
  return db.$transaction((tx: Tx) => applyLineFunding(tx, userId, prep, allocationId, rows), { timeout: 30_000 });
}

/**
 * Replaces a line's funding, inside the caller's transaction (so a line and
 * its funding are saved together, or not at all). Sources that aren't in
 * the month yet are added (a receivable with everything left of it, a
 * balance with what's needed); a source that's too small grows if its room
 * allows. Refused, with the reason, when a source or the line's envelope
 * would be over-committed. Call after the line's amount is final.
 */
export async function applyLineFunding(tx: Tx, userId: string, prep: FundingPrep, allocationId: string, rows: (SourceRef & { amount: number })[]) {
  const { ctx, occurrences } = prep;
  await lockBudget(tx, userId);
  const line = await tx.budgetCategoryAllocation.findFirst({ where: { id: allocationId, budgetPlanId: ctx.planId }, include: { category: true } });
  if (!line) throw new ValidationError("Budget line not found.");
  const all = await commitments(tx, userId);
  const wanted = new Map<string, { r: Awaited<ReturnType<typeof resolveSource>>; amount: number }>();
  for (const row of rows) {
    if (!(row.amount > 0)) continue;
    const r = await resolveSource(tx, ctx, row, occurrences);
    const prev = wanted.get(r.key);
    wanted.set(r.key, { r, amount: roundMoney((prev?.amount ?? 0) + row.amount) });
  }

  // The line's envelope: a parent shares one with its subcategories.
  const [planLines, cats] = await Promise.all([
    tx.budgetCategoryAllocation.findMany({ where: { budgetPlanId: line.budgetPlanId }, include: { funding: true } }),
    tx.category.findMany({ where: { userId }, select: { id: true, parentId: true } }),
  ]);
  const parentOf = new Map(cats.map((c) => [c.id, c.parentId]));
  const root = rootOf(line.categoryId, parentOf);
  const group = budgetGroups(planLines.map((l) => ({ categoryId: l.categoryId, amount: Number(l.budgetAmount) })), cats).find((g) => g.rootId === root);
  const total = roundMoney([...wanted.values()].reduce((t, w) => t + w.amount, 0));
  const lineCap = line.categoryId === root ? (group?.total ?? Number(line.budgetAmount)) : Number(line.budgetAmount);
  if (total > lineCap + 0.005) throw new ValidationError(`Funding (${money(total, ctx.currency)}) is more than ${line.category.name}'s ${money(lineCap, ctx.currency)}.`);
  const groupOthers = planLines.filter((l) => l.id !== line.id && rootOf(l.categoryId, parentOf) === root).reduce((t, l) => t + l.funding.reduce((u, f) => u + Number(f.amount), 0), 0);
  if (group && total + groupOthers > group.total + 0.005) {
    const rootName = (await tx.category.findUnique({ where: { id: root }, select: { name: true } }))?.name ?? "This group";
    throw new ValidationError(`${rootName} and its subcategories share ${money(group.total, ctx.currency)}, and ${money(groupOthers, ctx.currency)} of it is already funded. Fund at most ${money(Math.max(group.total - groupOthers, 0), ctx.currency)} here.`);
  }

  // Make sure each source can cover what the plan's lines draw from it.
  const sourceIds = new Map<string, string>();
  for (const [key, { r, amount }] of wanted) {
    const shape = r.existing ?? r.create!;
    const others = r.existing ? await drawnFrom(tx, r.existing.id, line.id) : 0;
    const needed = roundMoney(others + amount);
    const have = r.existing ? Number(r.existing.amount) : 0;
    if (needed > have + 0.005) {
      const ceiling = await sourceCeiling(tx, ctx, shape, occurrences, all);
      if (needed > ceiling + 0.005) throw new ValidationError(roomMessage(shape.kind, r.existing?.label ?? r.create!.label, Math.max(ceiling - others, 0), ctx.currency));
      // A new receivable joins the month with everything left of it; a
      // balance is set aside only as far as it's needed.
      const next = roundMoney(shape.kind === "RECEIVABLE" && !r.existing ? ceiling : needed);
      if (r.existing) await tx.budgetSource.update({ where: { id: r.existing.id }, data: { amount: next } });
      else {
        const created = await tx.budgetSource.create({
          data: { budgetPlanId: line.budgetPlanId, sourceKey: key, ...r.create!, amount: next, sortOrder: await tx.budgetSource.count({ where: { budgetPlanId: line.budgetPlanId } }) },
        });
        sourceIds.set(key, created.id);
      }
    }
    if (r.existing) sourceIds.set(key, r.existing.id);
  }

  await tx.budgetFunding.deleteMany({ where: { allocationId: line.id } });
  for (const [key, { amount }] of wanted) {
    await tx.budgetFunding.create({ data: { allocationId: line.id, sourceId: sourceIds.get(key)!, amount } });
  }
  await audit(tx, userId, "budget", line.id, "budget.funding", `Funding for ${line.category.name} (${ctx.month}) set`, {
    total,
    sources: [...wanted.values()].map((w) => ({ source: w.r.existing?.label ?? w.r.create!.label, amount: w.amount })),
  });
  return { funded: total };
}

/** The loan and scheduled payment a line links to must be the user's own
 * (and the schedule an outgoing payment). Linking changes neither. */
export async function assertLineLinks(userId: string, links: { loanId?: string | null; paymentScheduleId?: string | null }) {
  if (links.loanId && !(await db.loan.findFirst({ where: { id: links.loanId, userId }, select: { id: true } }))) throw new ValidationError("Loan not found.");
  if (links.paymentScheduleId && !(await db.scheduledCredit.findFirst({ where: { id: links.paymentScheduleId, userId, direction: "PAYMENT" }, select: { id: true } }))) {
    throw new ValidationError("Scheduled payment not found.");
  }
}

/** A line's amount is going down: refuse if its funding would then exceed it. */
export async function assertFundingFits(tx: Tx, allocationId: string, newAmount: number, label: string, currency: string) {
  const r = await tx.budgetFunding.aggregate({ where: { allocationId }, _sum: { amount: true } });
  const funded = Number(r._sum.amount ?? 0);
  if (funded > newAmount + 0.005) {
    throw new ValidationError(`${label} has ${money(funded, currency)} of funding. Lower its funding first, or edit the line to change both.`);
  }
}

// ------------------------------------------------------------------ view

export interface SourceView {
  id: string;
  kind: SourceKind;
  label: string;
  amount: number;
  /** Receivables: where it stands. Accounts: null. */
  state: ReceivableState | null;
  date: string | null;
  scheduleId: string | null;
  occurrenceDate: string | null;
  accountId: string | null;
  /** The receivable's own amount and currency (what's expected or was received). */
  native: { amount: number; currency: string } | null;
  /** Funding given to budget lines from this source. */
  allocated: number;
  /** Not yet given to any line. */
  unallocated: number;
  /** How much of `amount` the source can no longer cover (cancelled, reduced, received short, balance gone). */
  short: number;
  /** Plain-language note when something needs attention. */
  note: string | null;
}

export interface FundingOption {
  ref: SourceRef;
  key: string;
  kind: SourceKind;
  label: string;
  detail: string;
  state: ReceivableState | null;
  /** Most this plan could draw from it now (plan currency), counting what it already has. */
  room: number;
  inPlan: boolean;
}

/** Sources, line funding and pickers for a month's budget page. */
export async function fundingView(userId: string, plan: { id: string; month: string; currency: string } | null) {
  if (!plan) return null;
  const { ctx } = await context(userId, plan.id);
  const [sources, all, accounts, funding] = await Promise.all([
    db.budgetSource.findMany({ where: { budgetPlanId: plan.id }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    commitments(db, userId),
    db.account.findMany({ where: { userId, status: { not: "CLOSED" } }, orderBy: { name: "asc" } }),
    db.budgetFunding.findMany({ where: { source: { budgetPlanId: plan.id } } }),
  ]);
  const openDates = all.filter((c) => c.occurrenceDate && c.budgetPlan.month >= ctx.currentMonth).map((c) => isoDate(c.occurrenceDate!));
  const occurrences = await receivableOccurrences(userId, plan.month, openDates.concat(sources.flatMap((s) => (s.occurrenceDate ? [isoDate(s.occurrenceDate)] : []))));
  const drawn = new Map<string, number>();
  for (const f of funding) drawn.set(f.sourceId, (drawn.get(f.sourceId) ?? 0) + Number(f.amount));
  const acct = new Map(accounts.map((a) => [a.id, a]));

  const views: SourceView[] = sources.map((s) => {
    const amount = Number(s.amount);
    const allocated = roundMoney(drawn.get(s.id) ?? 0);
    let state: ReceivableState | null = null;
    let room = 0;
    let native: SourceView["native"] = null;
    let date: string | null = null;
    let note: string | null = null;
    if (s.kind === "RECEIVABLE") {
      const o = s.scheduledCreditId && s.occurrenceDate ? occurrences.get(occKey(s.scheduledCreditId, isoDate(s.occurrenceDate))) : undefined;
      state = receivableState(o, ctx.today);
      room = receivableRoom(ctx, o, all);
      if (o) {
        native = { amount: o.amount, currency: o.currency };
        date = o.date;
      }
      if (state === "cancelled") note = "This income was cancelled, so it no longer backs this budget.";
      else if (state === "gone") note = "This income is no longer scheduled, so it no longer backs this budget.";
      else if (state === "overdue") note = "Expected but not received yet.";
      else if (state === "failed") note = "Couldn't be booked automatically. Check it in Receivables.";
    } else {
      const a = s.accountId ? acct.get(s.accountId) : undefined;
      room = a ? accountRoom(ctx, a, all, occurrences) : 0;
      if (!a) note = "This account is closed, so its balance no longer backs this budget.";
    }
    const short = roundMoney(Math.max(0, amount - room));
    if (short > 0 && !note) {
      note = s.kind === "RECEIVABLE"
        ? state === "received"
          ? `Received ${native ? money(native.amount, native.currency) : "less"}: ${money(short, ctx.currency)} less than this budget counts on.`
          : `${money(short, ctx.currency)} more than this income now covers.`
        : `The balance no longer covers ${money(short, ctx.currency)} of this.`;
    }
    return {
      id: s.id,
      kind: s.kind as SourceKind,
      label: s.kind === "ACCOUNT" ? (s.accountId ? (acct.get(s.accountId)?.name ?? s.label) : s.label) : s.label,
      amount,
      state,
      date,
      scheduleId: s.scheduledCreditId,
      occurrenceDate: s.occurrenceDate ? isoDate(s.occurrenceDate) : null,
      accountId: s.accountId,
      native,
      allocated,
      unallocated: roundMoney(amount - allocated),
      short,
      note,
    };
  });
  const byId = new Map(views.map((v) => [v.id, v]));

  // Pickers: income in the window, and accounts that hold the user's money.
  const options: FundingOption[] = [];
  for (const o of [...occurrences.values()].sort((a, b) => a.date.localeCompare(b.date))) {
    if (o.occurrenceDate < isoDate(monthRange(shiftMonth(plan.month, -1)).start) || o.occurrenceDate >= isoDate(monthRange(plan.month).end)) continue;
    const state = receivableState(o, ctx.today);
    if (!BACKS[state]) continue;
    const key = receivableKey(o.scheduleId, o.occurrenceDate);
    const inPlan = sources.find((s) => s.sourceKey === key);
    const room = receivableRoom(ctx, o, all);
    if (room <= 0 && !inPlan) continue;
    options.push({
      ref: inPlan ? { sourceId: inPlan.id } : { receivable: { scheduleId: o.scheduleId, occurrenceDate: o.occurrenceDate } },
      key,
      kind: "RECEIVABLE",
      label: o.scheduleName,
      detail: `${money(o.amount, o.currency)} · ${STATE_WORD[state]} ${shortDate(o.date)}`,
      state,
      room,
      inPlan: !!inPlan,
    });
  }
  for (const a of accounts) {
    if (isLiabilityAccount(a.accountType)) continue;
    const key = accountKey(a.id);
    const inPlan = sources.find((s) => s.sourceKey === key);
    options.push({
      ref: inPlan ? { sourceId: inPlan.id } : { accountId: a.id },
      key,
      kind: "ACCOUNT",
      label: a.name,
      detail: `Balance ${money(Number(a.currentBalance), a.currency)}`,
      state: null,
      room: accountRoom(ctx, a, all, occurrences),
      inPlan: !!inPlan,
    });
  }

  const lineFunding = new Map<string, { sourceId: string; label: string; kind: SourceKind; amount: number; atRisk: boolean }[]>();
  for (const f of funding) {
    const s = byId.get(f.sourceId);
    if (!s) continue;
    lineFunding.set(f.allocationId, [...(lineFunding.get(f.allocationId) ?? []), { sourceId: s.id, label: s.label, kind: s.kind, amount: Number(f.amount), atRisk: s.short > 0 }]);
  }

  const sum = (xs: SourceView[]) => roundMoney(xs.reduce((t, x) => t + x.amount, 0));
  return {
    sources: views,
    options,
    lineFunding,
    available: {
      total: sum(views),
      received: sum(views.filter((v) => v.state === "received")),
      expected: sum(views.filter((v) => v.kind === "RECEIVABLE" && v.state !== "received")),
      fromAccounts: sum(views.filter((v) => v.kind === "ACCOUNT")),
      short: roundMoney(views.reduce((t, v) => t + v.short, 0)),
    },
  };
}
