"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Area, AreaChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Check, ChevronDown, Pencil, Plus, Tags, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { formatCompactMoney, formatMoney } from "@/lib/currencies";
import { formatDate } from "@/lib/format";
import { tooltipStyle } from "@/lib/chart-colors";
import { categoryGrowth, categoryRows, linkKey, uncategorised, type CategoryLite, type CategoryRow, type InvestmentKind, type Position, type SaleLite } from "@/lib/category-metrics";
import { EmptyState, Panel, SkeletonBlock } from "@/components/app/PageHeader";
import { ConfirmAction } from "@/components/ConfirmAction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Investment categories on the Investments page: the user's own groupings
 * across all four kinds of holding. They only choose which holdings to look
 * at together — values always come from the holdings themselves.
 */

export type Category = CategoryLite & { createdAt?: string };

export const KIND_LABEL: Record<InvestmentKind, string> = { STOCK: "Stock", MUTUAL_FUND: "Fund", FIXED_DEPOSIT: "Deposit", OTHER: "Other asset" };
export const swatch = (color: number) => `var(--series-${Math.min(8, Math.max(1, color || 1))})`;

/** Filter value: a category id, "__none__" (in no category) or "" (all). */
export const UNCATEGORISED = "__none__";

interface Ctx {
  categories: Category[];
  loaded: boolean;
  of: (kind: InvestmentKind, id: string) => Category[];
  reload: () => Promise<void>;
  /** Opens the picker for one investment. */
  edit: (kind: InvestmentKind, id: string, name: string) => void;
  /** Narrows the page to one category (or clears with ""). */
  setFilter: (id: string) => void;
}
const CategoryContext = createContext<Ctx | null>(null);
export const useCategories = () => useContext(CategoryContext);

export function CategoryProvider({ children, onFilter }: { children: ReactNode; onFilter: (id: string) => void }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [target, setTarget] = useState<{ kind: InvestmentKind; id: string; name: string } | null>(null);
  const reload = useCallback(async () => {
    const res = await fetch("/api/investments/categories").catch(() => null);
    if (res?.ok) setCategories((await res.json()).categories ?? []);
    setLoaded(true);
  }, []);
  useEffect(() => {
    let alive = true;
    fetch("/api/investments/categories")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && d && setCategories(d.categories ?? []))
      .catch(() => {})
      .finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, []);
  const index = useMemo(() => {
    const m = new Map<string, Category[]>();
    for (const c of categories) for (const l of c.links) m.set(linkKey(l.kind, l.holdingId), [...(m.get(linkKey(l.kind, l.holdingId)) ?? []), c]);
    return m;
  }, [categories]);
  const value = useMemo<Ctx>(
    () => ({
      categories,
      loaded,
      of: (kind, id) => index.get(linkKey(kind, id)) ?? [],
      reload,
      edit: (kind, id, name) => setTarget({ kind, id, name }),
      setFilter: onFilter,
    }),
    [categories, loaded, index, reload, onFilter]
  );
  return (
    <CategoryContext.Provider value={value}>
      {children}
      <AssignDialog target={target} onClose={() => setTarget(null)} />
    </CategoryContext.Provider>
  );
}

/** Sort key: the first category's name, holdings in none last. */
export function useCategorySortKey() {
  const ctx = useCategories();
  return useCallback((kind: InvestmentKind, id: string) => ctx?.of(kind, id).map((c) => c.name.toLowerCase()).sort()[0] ?? "￿", [ctx]);
}

export function Dot({ color, className }: { color: number; className?: string }) {
  return <span aria-hidden className={cn("inline-block h-2 w-2 shrink-0 rounded-full", className)} style={{ background: swatch(color) }} />;
}

/** The categories on one row, and the way to change them. */
export function CategoryChips({ kind, id, name, className }: { kind: InvestmentKind; id: string; name: string; className?: string }) {
  const ctx = useCategories();
  if (!ctx) return null;
  const cats = ctx.of(kind, id);
  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-1", className)}>
      {cats.slice(0, 3).map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => ctx.setFilter(c.id)}
          title={`Show only ${c.name}`}
          className="inline-flex max-w-[9rem] cursor-pointer items-center gap-1 rounded-full border border-border bg-card px-1.5 py-px text-[11px] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
        >
          <Dot color={c.color} className="h-1.5 w-1.5" />
          <span className="truncate">{c.name}</span>
        </button>
      ))}
      {cats.length > 3 && <span className="text-[11px] text-muted-foreground" title={cats.slice(3).map((c) => c.name).join(", ")}>+{cats.length - 3}</span>}
      <button
        type="button"
        onClick={() => ctx.edit(kind, id, name)}
        aria-label={cats.length ? `Change categories for ${name}` : `Add ${name} to a category`}
        title={cats.length ? "Change categories" : "Add to a category"}
        className={cn(
          "inline-flex h-[18px] cursor-pointer items-center gap-0.5 rounded-full px-1 text-[11px] text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground",
          !cats.length && "border border-dashed border-border px-1.5"
        )}
      >
        {cats.length ? <Pencil className="h-2.5 w-2.5" /> : <><Plus className="h-2.5 w-2.5" />Category</>}
      </button>
    </div>
  );
}

export interface PickerValue { ids: string[]; newNames: string[] }
export const emptyPicker = (): PickerValue => ({ ids: [], newNames: [] });
export const pickerEmpty = (v: PickerValue) => !v.ids.length && !v.newNames.length;

/** Pick categories, or type a new one. A typed name that matches an existing
 * category (any capitals) selects that one instead of making a duplicate. */
export function CategoryPicker({ value, onChange, categories }: { value: PickerValue; onChange: (v: PickerValue) => void; categories: Category[] }) {
  const [draft, setDraft] = useState("");
  const toggle = (id: string) => onChange({ ...value, ids: value.ids.includes(id) ? value.ids.filter((x) => x !== id) : [...value.ids, id] });
  const add = () => {
    const n = draft.trim().replace(/\s+/g, " ");
    if (!n) return;
    const match = categories.find((c) => c.name.toLowerCase() === n.toLowerCase());
    if (match) onChange({ ...value, ids: value.ids.includes(match.id) ? value.ids : [...value.ids, match.id] });
    else if (!value.newNames.some((x) => x.toLowerCase() === n.toLowerCase())) onChange({ ...value, newNames: [...value.newNames, n] });
    setDraft("");
  };
  const suggestions = draft.trim() ? categories.filter((c) => c.name.toLowerCase().includes(draft.trim().toLowerCase()) && !value.ids.includes(c.id)).slice(0, 4) : [];
  return (
    <div className="space-y-2">
      {(categories.length > 0 || value.newNames.length > 0) && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Categories">
          {categories.map((c) => {
            const on = value.ids.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(c.id)}
                className={cn(
                  "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors",
                  on ? "border-foreground/40 bg-foreground/[0.06] font-medium text-foreground" : "border-border text-muted-foreground hover:border-foreground/25 hover:text-foreground"
                )}
              >
                {on ? <Check className="h-3 w-3" /> : <Dot color={c.color} />}
                {c.name}
              </button>
            );
          })}
          {value.newNames.map((n) => (
            <span key={n} className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-foreground/40 px-2.5 text-xs font-medium">
              <Plus className="h-3 w-3" />
              {n}
              <button type="button" aria-label={`Don't create ${n}`} onClick={() => onChange({ ...value, newNames: value.newNames.filter((x) => x !== n) })} className="cursor-pointer text-muted-foreground hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          maxLength={60}
          placeholder={categories.length ? "New category, e.g. Retirement" : "Name a category, e.g. Tech, Dad's, Retirement"}
          aria-label="New category name"
          className="h-8"
        />
        <Button type="button" variant="outline" size="sm" onClick={add} disabled={!draft.trim()}>Add</Button>
      </div>
      {suggestions.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Already have:{" "}
          {suggestions.map((c, i) => (
            <span key={c.id}>
              {i > 0 && ", "}
              <button type="button" className="cursor-pointer underline-offset-2 hover:underline" onClick={() => { toggle(c.id); setDraft(""); }}>{c.name}</button>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

/** Puts a newly added investment in the chosen categories. */
export async function assignCategories(kind: InvestmentKind, holdingId: string, v: PickerValue, mode: "add" | "replace" = "add") {
  if (mode === "add" && pickerEmpty(v)) return true;
  const res = await fetch("/api/investments/categories/assign", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, holdingId, categoryIds: v.ids, newNames: v.newNames, mode }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    toast.error(d.error || "Saved, but the categories couldn't be set. Try again from the row.");
    return false;
  }
  return true;
}

/** The "Categories" block for an add form. */
export function CategoryField({ value, onChange }: { value: PickerValue; onChange: (v: PickerValue) => void }) {
  const ctx = useCategories();
  return (
    <div className="space-y-1.5">
      <Label>Categories <span className="font-normal text-muted-foreground">(optional)</span></Label>
      <CategoryPicker value={value} onChange={onChange} categories={ctx?.categories ?? []} />
    </div>
  );
}

function AssignDialog({ target, onClose }: { target: { kind: InvestmentKind; id: string; name: string } | null; onClose: () => void }) {
  const ctx = useCategories()!;
  const [value, setValue] = useState<PickerValue>(emptyPicker);
  const [saving, setSaving] = useState(false);
  const [openFor, setOpenFor] = useState<string | null>(null);
  const key = target ? linkKey(target.kind, target.id) : null;
  if (key && openFor !== key) {
    setOpenFor(key);
    setValue({ ids: ctx.of(target!.kind, target!.id).map((c) => c.id), newNames: [] });
  }
  if (!key && openFor) setOpenFor(null);
  async function save() {
    if (!target) return;
    setSaving(true);
    const ok = await assignCategories(target.kind, target.id, value, "replace");
    setSaving(false);
    if (ok) {
      await ctx.reload();
      toast.success("Categories updated.");
      onClose();
    }
  }
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Categories for {target?.name}</DialogTitle>
          <DialogDescription>Group it however you like. Its value, purchases and sales don&apos;t change.</DialogDescription>
        </DialogHeader>
        <CategoryPicker value={value} onChange={setValue} categories={ctx.categories} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One row of the filter: all, each category, or none. Sits with the date
 * range, so both narrow the tabs together. */
export function CategoryBar({ filter, onFilter, onManage }: { filter: string; onFilter: (id: string) => void; onManage: () => void }) {
  const ctx = useCategories();
  if (!ctx?.loaded) return null;
  const cats = ctx.categories;
  const pill = (active: boolean) =>
    cn("inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors", active ? "border-foreground/40 bg-foreground/[0.06] font-medium text-foreground" : "border-border text-muted-foreground hover:border-foreground/25 hover:text-foreground");
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="eyebrow shrink-0">Category</span>
      <div role="radiogroup" aria-label="Category" className="order-last flex w-full min-w-0 gap-1.5 overflow-x-auto pb-0.5 sm:order-none sm:w-auto sm:flex-1">
        <button role="radio" aria-checked={!filter} onClick={() => onFilter("")} className={pill(!filter)}>All</button>
        {cats.map((c) => (
          <button key={c.id} role="radio" aria-checked={filter === c.id} onClick={() => onFilter(filter === c.id ? "" : c.id)} className={pill(filter === c.id)}>
            <Dot color={c.color} />
            {c.name}
            <span className="tabular-nums text-muted-foreground">{c.links.length}</span>
          </button>
        ))}
        {cats.length > 0 && (
          <button role="radio" aria-checked={filter === UNCATEGORISED} onClick={() => onFilter(filter === UNCATEGORISED ? "" : UNCATEGORISED)} className={pill(filter === UNCATEGORISED)}>
            Not in a category
          </button>
        )}
      </div>
      {filter && (
        <Button variant="ghost" size="sm" onClick={() => onFilter("")} className="ml-auto shrink-0 sm:ml-0">
          <X className="h-3.5 w-3.5" />Clear
        </Button>
      )}
      <Button variant="outline" size="sm" onClick={onManage} className={cn("shrink-0", !filter && "ml-auto sm:ml-0")}>
        <Tags className="h-3.5 w-3.5" />
        {cats.length ? "Manage" : "Add categories"}
      </Button>
    </div>
  );
}

/** Create, rename, recolour and remove categories. Removing never touches an
 * investment — it only ungroups them. */
export function CategoryManager({ open, onOpenChange, positions }: { open: boolean; onOpenChange: (o: boolean) => void; positions: Position[] }) {
  const ctx = useCategories()!;
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Category | null>(null);
  const byKey = useMemo(() => new Map(positions.map((p) => [linkKey(p.kind, p.id), p])), [positions]);

  async function call(url: string, method: string, body?: unknown) {
    setBusy(true);
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Something went wrong.");
      await ctx.reload();
      return d;
    } catch (e) {
      toast.error((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    if (!name.trim()) return;
    const d = await call("/api/investments/categories", "POST", { name });
    if (d) {
      if (!d.created) toast.info(`You already have "${d.category.name}".`);
      setName("");
    }
  }
  async function rename() {
    if (!editing) return;
    const was = ctx.categories.find((c) => c.id === editing.id);
    if (!editing.name.trim() || editing.name.trim() === was?.name) return setEditing(null);
    if (await call(`/api/investments/categories/${editing.id}`, "PATCH", { name: editing.name })) setEditing(null);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Investment categories</DialogTitle>
            <DialogDescription>Your own groupings: industry, whose money it is, strategy, goal. An investment can be in several.</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
            className="flex gap-2"
          >
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="New category" aria-label="New category name" />
            <Button type="submit" disabled={busy || !name.trim()}><Plus className="h-4 w-4" />Create</Button>
          </form>
          {ctx.categories.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No categories yet. Create one here, or while adding an investment.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {ctx.categories.map((c) => {
                const members = c.links.map((l) => byKey.get(linkKey(l.kind, l.holdingId))).filter((p): p is Position => !!p);
                const closed = c.links.length - members.length;
                return (
                  <li key={c.id} className="space-y-2 p-3">
                    <div className="flex items-center gap-2">
                      {editing?.id === c.id ? (
                        <form
                          className="flex min-w-0 flex-1 gap-1.5"
                          onSubmit={(e) => {
                            e.preventDefault();
                            rename();
                          }}
                        >
                          <Input autoFocus value={editing.name} maxLength={60} onChange={(e) => setEditing({ id: c.id, name: e.target.value })} onKeyDown={(e) => e.key === "Escape" && setEditing(null)} aria-label="Category name" className="h-8" />
                          <Button type="submit" size="sm" disabled={busy}>Save</Button>
                          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                        </form>
                      ) : (
                        <>
                          <Dot color={c.color} className="h-2.5 w-2.5" />
                          <button type="button" onClick={() => setExpanded(expanded === c.id ? null : c.id)} className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left" aria-expanded={expanded === c.id}>
                            <span className="truncate font-medium">{c.name}</span>
                            <span className="shrink-0 text-xs text-muted-foreground">{members.length} {members.length === 1 ? "investment" : "investments"}</span>
                            <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", expanded === c.id && "rotate-180")} />
                          </button>
                          <Button variant="ghost" size="icon-sm" aria-label={`Rename ${c.name}`} onClick={() => setEditing({ id: c.id, name: c.name })}><Pencil className="h-3.5 w-3.5" /></Button>
                          <Button variant="ghost" size="icon-sm" aria-label={`Remove ${c.name}`} onClick={() => setRemoving(c)}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </>
                      )}
                    </div>
                    <div role="radiogroup" aria-label={`Colour for ${c.name}`} className="flex gap-1.5 pl-4">
                      {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                        <button
                          key={n}
                          type="button"
                          role="radio"
                          aria-checked={c.color === n}
                          aria-label={`Colour ${n}`}
                          disabled={busy}
                          onClick={() => c.color !== n && call(`/api/investments/categories/${c.id}`, "PATCH", { color: n })}
                          className={cn("h-4 w-4 cursor-pointer rounded-full ring-offset-2 ring-offset-background transition-shadow", c.color === n ? "ring-2 ring-foreground/60" : "hover:ring-1 hover:ring-foreground/30")}
                          style={{ background: swatch(n) }}
                        />
                      ))}
                    </div>
                    {expanded === c.id && (
                      <div className="pl-4 text-xs">
                        {members.length === 0 && !closed && <p className="text-muted-foreground">Nothing in it yet. Use the + Category button on any holding.</p>}
                        <ul className="space-y-1">
                          {members.map((p) => (
                            <li key={linkKey(p.kind, p.id)} className="flex items-center justify-between gap-2">
                              <span className="min-w-0 truncate">{p.name} <span className="text-muted-foreground">· {KIND_LABEL[p.kind]}</span></span>
                              <button type="button" className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground" onClick={() => ctx.edit(p.kind, p.id, p.name)}>Change</button>
                            </li>
                          ))}
                        </ul>
                        {closed > 0 && <p className="mt-1 text-muted-foreground">Plus {closed} sold or closed, kept so their realised profit stays in this category.</p>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmAction
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove "${removing?.name}"?`}
        description={
          <p>
            The category goes. {removing?.links.length ? `Its ${removing.links.length} ${removing.links.length === 1 ? "investment stays" : "investments stay"} exactly as they are, with their purchases, sales and history; they're just no longer grouped under it.` : "Nothing is in it."}
          </p>
        }
        confirmLabel="Remove category"
        onConfirm={async () => {
          if (!removing) return;
          const d = await call(`/api/investments/categories/${removing.id}`, "DELETE");
          if (d) {
            toast.success(`Removed ${d.name}. No investments were changed.`);
            setRemoving(null);
          }
        }}
      />
    </>
  );
}

const signed = (n: number, c: string) => `${n > 0.5 ? "+" : n < -0.5 ? "−" : ""}${formatMoney(Math.abs(Math.round(n)), c)}`;
const tone = (n: number) => (n > 0.5 ? "text-positive" : n < -0.5 ? "text-negative" : "text-muted-foreground");

type Period = "3M" | "6M" | "1Y" | "RANGE";

/** How each category is doing, with a growth chart for the one picked. */
export function CategoryPerformance({
  positions,
  sales,
  series,
  toBase,
  currency,
  portfolioValue,
  selected,
  onSelect,
  range,
  onManage,
}: {
  positions: Position[];
  sales: SaleLite[];
  series: Record<string, { d: string; v: number }[]> | null;
  toBase: (n: number, c: string) => number;
  currency: string;
  portfolioValue: number;
  selected: string;
  onSelect: (id: string) => void;
  range: { from: string; to: string };
  onManage: () => void;
}) {
  const ctx = useCategories();
  const cats = useMemo(() => ctx?.categories ?? [], [ctx]);
  const rows = useMemo(() => categoryRows(cats, positions, sales, toBase, portfolioValue), [cats, positions, sales, toBase, portfolioValue]);
  const loose = useMemo(() => uncategorised(cats, positions), [cats, positions]);
  const looseValue = loose.reduce((t, p) => t + toBase(p.value, p.currency), 0);
  const allocSum = rows.reduce((t, r) => t + r.allocation, 0);
  const overlap = useMemo(() => {
    const seen = new Map<string, number>();
    for (const c of cats) for (const l of c.links) seen.set(linkKey(l.kind, l.holdingId), (seen.get(linkKey(l.kind, l.holdingId)) ?? 0) + 1);
    return positions.filter((p) => (seen.get(linkKey(p.kind, p.id)) ?? 0) > 1).length;
  }, [cats, positions]);
  const current = rows.find((r) => r.id === selected) ?? null;

  if (!ctx?.loaded) return <SkeletonBlock className="h-48" />;
  if (!cats.length)
    return (
      <EmptyState icon={<Tags className="h-5 w-5" />} title="No categories yet" action={<Button size="sm" onClick={onManage}><Plus className="h-4 w-4" />Create a category</Button>}>
        Group investments your own way (an industry, whose money it is, a strategy or a goal) and see how each group is doing.
      </EmptyState>
    );

  return (
    <div className="space-y-4">
      <Panel padded={false} className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] tracking-[0.06em] text-muted-foreground uppercase">
                <th className="py-2.5 pr-3 pl-4 font-medium">Category</th>
                <th className="hidden px-3 py-2.5 text-right font-medium sm:table-cell">Holdings</th>
                <th className="hidden px-3 py-2.5 text-right font-medium md:table-cell">Invested</th>
                <th className="px-3 py-2.5 text-right font-medium">Value</th>
                <th className="px-3 py-2.5 text-right font-medium">Profit / loss</th>
                <th className="hidden px-3 py-2.5 font-medium lg:table-cell">Of portfolio</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => onSelect(selected === r.id ? "" : r.id)}
                  aria-selected={selected === r.id}
                  className={cn("cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40", selected === r.id && "bg-muted/60")}
                >
                  <td className="py-2.5 pr-3 pl-4">
                    <span className="flex items-center gap-2 font-medium"><Dot color={r.color} className="h-2.5 w-2.5" />{r.name}</span>
                    {r.soldCount > 0 && <span className={cn("block pl-4.5 text-xs", tone(r.realized))}>{signed(r.realized, currency)} realised from {r.soldCount} {r.soldCount === 1 ? "sale" : "sales"}</span>}
                  </td>
                  <td className="hidden px-3 py-2.5 text-right tabular-nums sm:table-cell">{r.count}</td>
                  <td className="hidden px-3 py-2.5 text-right tabular-nums md:table-cell">{formatMoney(Math.round(r.invested), currency)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(Math.round(r.value), currency)}</td>
                  <td className={cn("px-3 py-2.5 text-right tabular-nums", tone(r.pnl))}>
                    {r.count ? signed(r.pnl, currency) : "–"}
                    <span className="block text-xs">{r.pct == null ? "" : `${r.pct >= 0 ? "+" : "−"}${Math.abs(r.pct).toFixed(1)}%`}</span>
                  </td>
                  <td className="hidden px-3 py-2.5 lg:table-cell">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${Math.min(100, r.allocation)}%`, background: swatch(r.color) }} /></div>
                      <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">{r.allocation.toFixed(1)}%</span>
                    </div>
                  </td>
                </tr>
              ))}
              {loose.length > 0 && (
                <tr className="text-muted-foreground">
                  <td className="py-2.5 pr-3 pl-4 italic">Not in a category</td>
                  <td className="hidden px-3 py-2.5 text-right tabular-nums sm:table-cell">{loose.length}</td>
                  <td className="hidden px-3 py-2.5 md:table-cell" />
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(Math.round(looseValue), currency)}</td>
                  <td />
                  <td className="hidden px-3 py-2.5 text-right text-xs tabular-nums lg:table-cell">{portfolioValue > 0 ? ((looseValue / portfolioValue) * 100).toFixed(1) : "0.0"}%</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
          Figures use each holding&apos;s current value, converted to {currency} at today&apos;s rates; the date filter doesn&apos;t change them.
          {overlap > 0
            ? ` ${overlap} ${overlap === 1 ? "holding is" : "holdings are"} in more than one category and counted fully in each, so these add up to ${allocSum.toFixed(0)}% rather than 100%. Your portfolio total above counts every holding once.`
            : " Share of portfolio is of your whole portfolio's current value, including proceeds waiting to be reinvested."}
        </p>
      </Panel>

      {current ? (
        <CategoryDetail row={current} series={series} toBase={toBase} currency={currency} range={range} />
      ) : (
        <p className="text-center text-sm text-muted-foreground">Pick a category to see how it has grown and what&apos;s in it.</p>
      )}
    </div>
  );
}

function CategoryDetail({ row, series, toBase, currency, range }: { row: CategoryRow; series: Record<string, { d: string; v: number }[]> | null; toBase: (n: number, c: string) => number; currency: string; range: { from: string; to: string } }) {
  const ctx = useCategories()!;
  const ranged = !!(range.from || range.to);
  const [periodState, setPeriod] = useState<Period>("1Y");
  const period: Period = ranged ? "RANGE" : periodState === "RANGE" ? "1Y" : periodState;
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const growth = useMemo(() => {
    if (!series) return null;
    const back = (m: number) => {
      const d = new Date(`${today}T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() - m);
      return d.toISOString().slice(0, 10);
    };
    const r = period === "RANGE" ? { from: range.from || undefined, to: range.to || undefined } : { from: back(period === "3M" ? 3 : period === "6M" ? 6 : 12) };
    return categoryGrowth(row.positions, series, toBase, r, today);
  }, [row.positions, series, toBase, period, range, today]);
  const first = growth?.points[0];
  const last = growth?.points.at(-1);
  // Growth over the window, net of money added during it.
  const change = first && last ? last.value - first.value - (last.invested - first.invested) : 0;
  const money = (v: number) => formatMoney(Math.round(v), currency);
  const short = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });

  return (
    <Panel className="settle space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow flex items-center gap-1.5"><Dot color={row.color} />{row.name}</p>
          <p className="mt-1 font-display text-2xl tabular-nums">{money(row.value)}</p>
          <p className="text-xs text-muted-foreground">
            {row.count} {row.count === 1 ? "holding" : "holdings"} · {money(row.invested)} invested ·{" "}
            <span className={tone(row.pnl)}>{signed(row.pnl, currency)}{row.pct != null && ` (${row.pct >= 0 ? "+" : "−"}${Math.abs(row.pct).toFixed(1)}%)`}</span> · {row.allocation.toFixed(1)}% of portfolio
          </p>
        </div>
        {!ranged && (
          <div role="radiogroup" aria-label="Chart period" className="inline-flex rounded-lg bg-muted p-0.5 text-xs">
            {(["3M", "6M", "1Y"] as const).map((p) => (
              <button key={p} role="radio" aria-checked={period === p} onClick={() => setPeriod(p)} className={cn("h-7 cursor-pointer rounded-md px-2.5 transition-colors", period === p ? "bg-card font-medium shadow-card" : "text-muted-foreground hover:text-foreground")}>
                {p}
              </button>
            ))}
          </div>
        )}
      </div>

      {!growth ? (
        <SkeletonBlock className="h-56" />
      ) : growth.points.length < 2 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          {growth.charted.length ? "Not enough price history in this period to draw a line." : "None of these holdings has a price history to chart."}
        </p>
      ) : (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <div className="flex flex-wrap gap-4">
              <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-3 rounded" style={{ background: swatch(row.color) }} />Value</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-0 w-3 border-t border-dashed border-muted-foreground" />Invested</span>
            </div>
            <span>
              {short(first!.d)} – {short(last!.d)}: <span className={cn("font-medium", tone(change))}>{signed(change, currency)}</span> growth, after money added
            </span>
          </div>
          <ResponsiveContainer width="100%" height={240} className="mt-3">
            <AreaChart data={growth.points} margin={{ left: 4, right: 8, top: 8 }}>
              <defs>
                <linearGradient id={`cg-${row.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={swatch(row.color)} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={swatch(row.color)} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="d" tickFormatter={short} tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" minTickGap={40} />
              <YAxis tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" width={64} tickFormatter={(v) => formatCompactMoney(Number(v), currency)} domain={["auto", "auto"]} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={(d) => formatDate(String(d))} formatter={(v, n) => [money(Number(v)), n === "value" ? "Value" : "Invested"]} />
              <Area type="linear" dataKey="value" stroke={swatch(row.color)} strokeWidth={2} fill={`url(#cg-${row.id})`} isAnimationActive={false} />
              <Line type="stepAfter" dataKey="invested" stroke="var(--muted-foreground)" strokeDasharray="4 4" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
      {growth && (
        <p className="text-xs text-muted-foreground">
          The holdings in this category now, at each day&apos;s closing price from the day each was bought{growth.charted.some((p) => p.kind === "FIXED_DEPOSIT") ? "; deposits by the interest they've earned" : ""}. Holdings sold earlier aren&apos;t in the line.
          {growth.historyFrom && first?.d === growth.historyFrom && ` Price history starts ${formatDate(growth.historyFrom)}.`}
          {growth.skipped.length > 0 && ` Not charted: ${growth.skipped.map((s) => `${s.position.name} (${s.reason}${s.position.valuedOn ? `, last updated ${formatDate(s.position.valuedOn)}` : ""})`).join("; ")}.`}
        </p>
      )}

      <div>
        <p className="eyebrow mb-2">In this category</p>
        {row.positions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No current holdings{row.soldCount ? "; its sold ones are under Sold & closed" : ""}.</p>
        ) : (
          <ul className="divide-y divide-border/60 text-sm">
            {[...row.positions]
              .sort((a, b) => toBase(b.value, b.currency) - toBase(a.value, a.currency))
              .map((p) => {
                const pl = p.value - p.invested;
                return (
                  <li key={linkKey(p.kind, p.id)} className="flex items-center gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{p.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {KIND_LABEL[p.kind]}
                        {p.valuedOn !== undefined && ` · valued by hand${p.valuedOn ? `, updated ${formatDate(p.valuedOn)}` : ""}`}
                      </p>
                    </div>
                    <div className="text-right tabular-nums">
                      <p>{formatMoney(p.value, p.currency)}</p>
                      <p className={cn("text-xs", tone(pl))}>{signed(pl, p.currency)}</p>
                    </div>
                    <Button variant="ghost" size="icon-sm" aria-label={`Change categories for ${p.name}`} onClick={() => ctx.edit(p.kind, p.id, p.name)}><Tags className="h-3.5 w-3.5" /></Button>
                  </li>
                );
              })}
          </ul>
        )}
        {row.manual > 0 && <p className="mt-2 text-xs text-muted-foreground">{row.manual} {row.manual === 1 ? "holding is" : "holdings are"} valued by hand{row.oldestValuation ? `; the least recently updated was on ${formatDate(row.oldestValuation)}` : ""}. Update it from its row to keep this current.</p>}
      </div>
    </Panel>
  );
}
