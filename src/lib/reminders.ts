import { db } from "@/lib/db";
import { formatMoney } from "@/lib/currencies";
import { addDaysUTC, isoDate, monthKey } from "@/lib/dates";
import { loadOccurrences, userToday } from "@/lib/schedules";
import { budgetForMonth } from "@/lib/budget";
import { fdCurrentValue } from "@/lib/investments";

export type ReminderTone = "warning" | "negative" | "info" | "positive";
export interface Reminder {
  id: string; // stable, so a dismissal sticks
  kind: "income" | "bill" | "budget" | "card" | "deposit" | "pending";
  tone: ReminderTone;
  title: string;
  body: string;
  href: string;
  date?: string;
}

/**
 * What deserves the user's attention right now, driven by their Reminder
 * settings: income and bills due in the next week, anything waiting for
 * confirmation, budget lines past the warning threshold, cards close to their
 * limit, and deposits maturing within a month.
 */
const nice = (d: string | Date) =>
  new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export async function remindersFor(userId: string): Promise<Reminder[]> {
  const setting = await db.setting.upsert({ where: { userId }, update: {}, create: { userId } });
  const today = await userToday(userId);
  const out: Reminder[] = [];

  const occ = await loadOccurrences(userId, addDaysUTC(today, -400), addDaysUTC(today, 7));
  for (const o of occ) {
    const amt = formatMoney(o.amount, o.currency);
    if (o.status === "PENDING" || o.status === "FAILED") {
      out.push({
        id: `pending:${o.scheduleId}:${o.occurrenceDate}`,
        kind: "pending",
        tone: o.status === "FAILED" ? "negative" : "warning",
        title: o.status === "FAILED" ? `${o.scheduleName} couldn't be booked` : o.direction === "INCOME" ? `Did ${o.scheduleName} arrive?` : `Did you pay ${o.scheduleName}?`,
        body: `${amt}, due ${nice(o.date)}. Confirm or skip it.`,
        href: o.direction === "INCOME" ? "/receivables" : "/payments",
        date: o.date,
      });
    } else if (o.status === "SCHEDULED" && o.date > isoDate(today)) {
      if (o.direction === "INCOME" && setting.notifyUpcomingCredits) {
        out.push({ id: `income:${o.scheduleId}:${o.occurrenceDate}`, kind: "income", tone: "positive", title: `${o.scheduleName} is on its way`, body: `${amt} expected on ${nice(o.date)}.`, href: "/receivables", date: o.date });
      }
      if (o.direction === "PAYMENT" && setting.notifyUpcomingBills) {
        out.push({ id: `bill:${o.scheduleId}:${o.occurrenceDate}`, kind: "bill", tone: "info", title: `${o.scheduleName} due soon`, body: `${amt} on ${nice(o.date)}.`, href: "/payments", date: o.date });
      }
    }
  }

  const month = monthKey(today);
  const budget = await budgetForMonth(userId, month);
  for (const l of budget.lines) {
    if (l.budgetAmount <= 0) continue;
    const used = (l.spent / l.budgetAmount) * 100;
    if (used >= setting.budgetAlertThreshold) {
      out.push({
        id: `budget:${month}:${l.categoryId}:${used > 100.5 ? "over" : used >= 99.5 ? "full" : "near"}`,
        kind: "budget",
        tone: used > 100.5 ? "negative" : "warning",
        title: used > 100.5 ? `${l.categoryName} is over budget` : used >= 99.5 ? `${l.categoryName} is fully used` : `${l.categoryName} is at ${Math.round(used)}%`,
        body: `${formatMoney(Math.round(l.spent), budget.currency)} of ${formatMoney(Math.round(l.budgetAmount), budget.currency)} this month.`,
        href: "/budget",
      });
    }
  }

  const cards = await db.account.findMany({ where: { userId, accountType: "CREDIT_CARD", status: { not: "CLOSED" }, creditLimit: { not: null } } });
  for (const c of cards) {
    const owed = Math.max(-Number(c.currentBalance), 0);
    const limit = Number(c.creditLimit);
    if (limit > 0 && owed / limit >= 0.9) {
      out.push({ id: `card:${c.id}:${monthKey(today)}`, kind: "card", tone: "warning", title: `${c.name} is near its limit`, body: `${formatMoney(owed, c.currency)} of ${formatMoney(limit, c.currency)} used.`, href: `/accounts/${c.id}` });
    }
  }

  const soon = addDaysUTC(today, 30);
  const deposits = await db.fixedDeposit.findMany({ where: { userId, maturityDate: { gte: today, lte: soon } } });
  for (const d of deposits) {
    out.push({
      id: `deposit:${d.id}`,
      kind: "deposit",
      tone: "info",
      title: `${d.bank} deposit matures soon`,
      body: `About ${formatMoney(Math.round(fdCurrentValue(Number(d.principal), Number(d.interestRate), d.startDate, d.maturityDate)), d.currency)} on ${nice(d.maturityDate)}.`,
      href: "/investments",
      date: isoDate(d.maturityDate),
    });
  }

  const me = await db.user.findUnique({ where: { id: userId }, select: { securityAnswerHash: true, passwordHash: true } });
  if (me?.passwordHash && !me.securityAnswerHash) {
    out.push({ id: "security-question", kind: "pending", tone: "info", title: "Set a secret question", body: "Without one you can't reset a forgotten password.", href: "/settings" });
  }

  const rank: Record<Reminder["kind"], number> = { pending: 0, budget: 1, card: 2, bill: 3, income: 4, deposit: 5 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || (a.date ?? "").localeCompare(b.date ?? ""));
}
