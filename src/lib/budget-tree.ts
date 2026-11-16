/**
 * Budgets over a two-level category tree (Groceries › Dairy), without double
 * counting. Pure, so the server, the reports and the tests share one rule:
 *
 *  - A parent's own line is the group's envelope ("£200 for Groceries").
 *  - Subcategory lines are a breakdown of that envelope, not extra money.
 *  - The group counts once in every total: the envelope, or the breakdown if
 *    there is no envelope or the breakdown has grown past it.
 *  - Spending anywhere in the group (the parent or any subcategory, budgeted
 *    or not) counts against the group.
 */

export interface TreeCategory {
  id: string;
  parentId: string | null;
}

export interface PlannedLine {
  categoryId: string;
  amount: number;
}

export interface BudgetGroup {
  rootId: string;
  /** The parent's own line (the envelope), or null when it has none. */
  own: number | null;
  /** Total of the subcategory lines. */
  breakdown: number;
  /** What the group counts for in totals. Never envelope + breakdown. */
  total: number;
  /** Part of the envelope not split into subcategories. */
  unassigned: number;
  /** How far the breakdown is over the envelope (0 when it isn't). */
  over: number;
  /** The parent and every subcategory: their spending counts here. */
  members: string[];
  /** Subcategories that have a line of their own. */
  budgetedChildren: string[];
}

const cents = (n: number) => Math.round(n * 100) / 100;

/** The top-level category a category belongs to (itself when top-level). */
export function rootOf(id: string, parentOf: Map<string, string | null>): string {
  const p = parentOf.get(id);
  return p ? p : id;
}

/** One group per top-level category that has a line itself or in a subcategory. */
export function budgetGroups(lines: PlannedLine[], categories: TreeCategory[]): BudgetGroup[] {
  const parentOf = new Map(categories.map((c) => [c.id, c.parentId]));
  const childrenOf = new Map<string, string[]>();
  for (const c of categories) if (c.parentId) childrenOf.set(c.parentId, [...(childrenOf.get(c.parentId) ?? []), c.id]);

  const groups = new Map<string, { own: number | null; breakdown: number; budgetedChildren: string[] }>();
  for (const l of lines) {
    const root = rootOf(l.categoryId, parentOf);
    const g = groups.get(root) ?? { own: null, breakdown: 0, budgetedChildren: [] };
    if (root === l.categoryId) g.own = (g.own ?? 0) + l.amount;
    else {
      g.breakdown += l.amount;
      g.budgetedChildren.push(l.categoryId);
    }
    groups.set(root, g);
  }
  return [...groups.entries()].map(([rootId, g]) => {
    const own = g.own;
    const breakdown = cents(g.breakdown);
    const total = cents(own == null ? breakdown : Math.max(own, breakdown));
    return {
      rootId,
      own,
      breakdown,
      total,
      unassigned: own == null ? 0 : cents(Math.max(own - breakdown, 0)),
      over: own == null ? 0 : cents(Math.max(breakdown - own, 0)),
      members: [rootId, ...(childrenOf.get(rootId) ?? [])],
      budgetedChildren: g.budgetedChildren,
    };
  });
}

/** Everything a plan budgets, each group counted once. */
export function planTotal(groups: BudgetGroup[]): number {
  return cents(groups.reduce((s, g) => s + g.total, 0));
}

/** Spending that counts against a group. */
export function groupSpent(group: Pick<BudgetGroup, "members">, spend: Map<string, number>): number {
  return group.members.reduce((s, id) => s + (spend.get(id) ?? 0), 0);
}

export interface OrderableCategory extends TreeCategory {
  name: string;
  sortOrder: number;
}

/** Categories in tree order (each parent followed by its subcategories),
 * with their depth: what every category picker shows. A subcategory whose
 * parent is missing is shown at the top level rather than dropped. */
export function orderTree<T extends OrderableCategory>(categories: T[]): (T & { depth: 0 | 1 })[] {
  const byOrder = (a: T, b: T) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
  const ids = new Set(categories.map((c) => c.id));
  const tops = categories.filter((c) => !c.parentId || !ids.has(c.parentId)).sort(byOrder);
  const out: (T & { depth: 0 | 1 })[] = [];
  for (const t of tops) {
    out.push({ ...t, depth: 0 });
    for (const c of categories.filter((x) => x.parentId === t.id).sort(byOrder)) out.push({ ...c, depth: 1 });
  }
  return out;
}
