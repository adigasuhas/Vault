/**
 * Notebook entries that look like the same thing written down twice: same
 * title (any capitals or spacing), amount, currency and date, both still
 * open. One of each pair counts in "Paid by you" and the other in "Paid for
 * you by others" when their payers differ, so the amount shows on both
 * sides. They're only flagged for the user to review; nothing is changed
 * automatically, since two genuine identical entries are possible.
 */

export interface EntryLike {
  id: string;
  title: string;
  amount: string | number | { toString(): string };
  currency: string;
  date: string | Date;
  paidBy: string;
  status: string;
  createdAt?: string | Date;
}

const norm = (t: string) => t.trim().replace(/\s+/g, " ").toLowerCase();
const day = (d: string | Date) => (typeof d === "string" ? d : d.toISOString()).slice(0, 10);

export function sameThingKey(e: EntryLike) {
  return [norm(e.title), Number(e.amount.toString()).toFixed(2), e.currency, day(e.date)].join("|");
}

/** Groups of open entry ids (oldest first) that look duplicated. */
export function possibleDuplicates(entries: EntryLike[]): string[][] {
  const groups = new Map<string, EntryLike[]>();
  for (const e of entries) {
    if (e.status !== "OPEN") continue;
    const k = sameThingKey(e);
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => [...g].sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? ""))).map((e) => e.id));
}

/** The totals the Notebook shows, per currency, counting each entry once. */
export function notebookTotals(entries: EntryLike[]) {
  const add = (m: Record<string, number>, e: EntryLike) => ({ ...m, [e.currency]: Math.round(((m[e.currency] ?? 0) + Number(e.amount.toString())) * 100) / 100 });
  const open = entries.filter((e) => e.status === "OPEN");
  return {
    open: open.reduce(add, {}),
    byMe: open.filter((e) => e.paidBy === "ME").reduce(add, {}),
    byOthers: open.filter((e) => e.paidBy === "OTHER").reduce(add, {}),
  };
}
