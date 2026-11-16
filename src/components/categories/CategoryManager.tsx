"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, ChevronUp, CornerDownRight, FolderTree, MoreHorizontal, Plus, Repeat } from "lucide-react";
import { api } from "@/lib/client";
import { cn } from "@/lib/utils";
import { STARTER_GROUPS } from "@/lib/category-starters";
import { Panel, SkeletonBlock, ErrorState } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/**
 * Settings → Categories: the two-level tree every expense, schedule and
 * budget line is filed under. Everything here only organises: renaming,
 * moving or reordering never changes an amount, a date or a balance, and
 * deleting a category that's in use moves what it holds somewhere else.
 */

export interface CategoryItem {
  id: string;
  name: string;
  parentId: string | null;
  parentName: string | null;
  path: string;
  depth: 0 | 1;
  color: string | null;
  sortOrder: number;
  isSystem: boolean;
  isDefault: boolean;
  loan: { id: string; name: string } | null;
}

interface Usage {
  expenses: number;
  ledgerEntries: number;
  schedules: number;
  loans: { id: string; name: string }[];
  budgetLines: number;
  fundedBudgetLines: number;
  subcategories: { id: string; name: string }[];
  recurring: boolean;
}

const TOP = "__top__";
const COLORS = ["1", "2", "3", "4", "5", "6", "7", "8"];
const swatch = (c: string | null) => (c ? `var(--series-${c})` : "transparent");

function ColorDot({ color, className }: { color: string | null; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", !color && "border border-dashed border-muted-foreground/50", className)}
      style={{ background: swatch(color) }}
    />
  );
}

function ColorPicker({ value, onChange }: { value: string | null; onChange: (c: string | null) => void }) {
  return (
    <div role="radiogroup" aria-label="Colour" className="flex flex-wrap items-center gap-1.5">
      <button type="button" role="radio" aria-checked={!value} aria-label="No colour" onClick={() => onChange(null)} className={cn("grid h-7 w-7 cursor-pointer place-items-center rounded-md border transition-colors", !value ? "border-foreground/50" : "border-transparent hover:border-border")}>
        <ColorDot color={null} />
      </button>
      {COLORS.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={`Colour ${c}`} onClick={() => onChange(c)} className={cn("grid h-7 w-7 cursor-pointer place-items-center rounded-md border transition-colors", value === c ? "border-foreground/50" : "border-transparent hover:border-border")}>
          <ColorDot color={c} className="h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  );
}

/** Where a category can live: the top level, or under a top-level category. */
function ParentSelect({ value, onChange, parents, id }: { value: string | null; onChange: (v: string | null) => void; parents: CategoryItem[]; id?: string }) {
  return (
    <Select value={value ?? TOP} onValueChange={(v) => onChange(v === TOP ? null : v)}>
      <SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={TOP}>Top level (no parent)</SelectItem>
        {parents.length > 0 && <SelectSeparator />}
        {parents.map((p) => <SelectItem key={p.id} value={p.id}>Under {p.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function CategoryManager() {
  const [cats, setCats] = useState<CategoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState<{ parentId: string | null } | null>(null);
  const [editing, setEditing] = useState<CategoryItem | null>(null);
  const [deleting, setDeleting] = useState<CategoryItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [nonce, setNonce] = useState(0);
  const load = useCallback(() => setNonce((n) => n + 1), []);
  useEffect(() => {
    let alive = true;
    api<{ categories: CategoryItem[] }>("/api/categories")
      .then((d) => {
        if (!alive) return;
        setCats(d.categories);
        setError(null);
      })
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [nonce]);

  const tops = useMemo(() => (cats ?? []).filter((c) => c.depth === 0), [cats]);
  const childrenOf = useCallback((id: string) => (cats ?? []).filter((c) => c.parentId === id), [cats]);
  // Starters that could be grouped the way new accounts get them.
  const groupable = useMemo(() => {
    const names = new Set(STARTER_GROUPS.flatMap((g) => g.children));
    const withKids = new Set((cats ?? []).map((c) => c.parentId).filter(Boolean));
    return (cats ?? []).filter((c) => c.isSystem && !c.parentId && names.has(c.name) && !withKids.has(c.id)).length;
  }, [cats]);

  async function move(c: CategoryItem, dir: -1 | 1) {
    const siblings = c.parentId ? childrenOf(c.parentId) : tops;
    const i = siblings.findIndex((s) => s.id === c.id);
    const j = i + dir;
    if (j < 0 || j >= siblings.length) return;
    const order = siblings.map((s) => s.id);
    [order[i], order[j]] = [order[j], order[i]];
    try {
      await api("/api/categories/reorder", { body: { parentId: c.parentId, order } });
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function groupStarters() {
    setBusy(true);
    try {
      const r = await api<{ moved: number; created: number }>("/api/categories/group-starters", { body: {} });
      toast.success(r.moved ? `${plural(r.moved, "starter category", "starter categories")} grouped. Their history and budgets are unchanged.` : "Nothing to group.");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !cats) return <ErrorState message={error} onRetry={load} />;
  if (!cats) return <SkeletonBlock className="h-64" />;

  const row = (c: CategoryItem, siblings: CategoryItem[]) => {
    const i = siblings.findIndex((s) => s.id === c.id);
    const kids = c.depth === 0 ? childrenOf(c.id) : [];
    const open = !collapsed.has(c.id);
    return (
      <div className={cn("group flex min-h-12 items-center gap-2 py-1.5 pr-3", c.depth === 0 ? "pl-3" : "pl-9")}>
        {c.depth === 0 ? (
          kids.length ? (
            <button
              type="button"
              aria-expanded={open}
              aria-label={`${open ? "Collapse" : "Expand"} ${c.name}`}
              onClick={() => setCollapsed((s) => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })}
              className="grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          ) : (
            <span className="w-7 shrink-0" />
          )
        ) : (
          <CornerDownRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
        )}
        {c.color ? <ColorDot color={c.color} /> : <span aria-hidden className="w-2.5 shrink-0" />}
        <div className="min-w-0 flex-1">
          <p className={cn("truncate text-sm", c.depth === 0 && "font-medium")}>{c.name}</p>
          {(kids.length > 0 || c.isDefault || c.loan) && (
            <p className="truncate text-[11.5px] text-muted-foreground">
              {[kids.length ? plural(kids.length, "subcategory", "subcategories") : null, c.isDefault ? "repeats monthly" : null, c.loan ? `EMIs of ${c.loan.name}` : null].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
        {c.isDefault && <Repeat aria-label="Repeats monthly" className="hidden h-3.5 w-3.5 text-muted-foreground sm:block" />}
        <div className="flex shrink-0 items-center">
          <Button variant="ghost" size="icon-sm" aria-label={`Move ${c.name} up`} disabled={i <= 0} onClick={() => move(c, -1)}><ChevronUp className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon-sm" aria-label={`Move ${c.name} down`} disabled={i >= siblings.length - 1} onClick={() => move(c, 1)}><ChevronDown className="h-4 w-4" /></Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`More for ${c.name}`}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={() => setEditing(c)}>Rename, colour or move…</DropdownMenuItem>
              {c.depth === 0 && <DropdownMenuItem onClick={() => setCreating({ parentId: c.id })}>Add subcategory…</DropdownMenuItem>}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setDeleting(c)}>Delete…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    );
  };

  return (
    <>
      <Panel padded={false} className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <p className="mr-auto text-xs text-muted-foreground">{plural(tops.length, "category", "categories")} · {plural(cats.length - tops.length, "subcategory", "subcategories")}</p>
          {groupable > 0 && (
            <Button size="sm" variant="outline" disabled={busy} onClick={groupStarters} title="Food › Groceries, Eating out; Home & bills › Rent, Utilities… Only starters you haven't organised move.">
              <FolderTree className="h-3.5 w-3.5" /> Group starter categories
            </Button>
          )}
          <Button size="sm" onClick={() => setCreating({ parentId: null })}><Plus className="h-3.5 w-3.5" /> New category</Button>
        </div>
        <ul aria-label="Categories" className="divide-y divide-border/70">
          {tops.map((t) => {
            const kids = childrenOf(t.id);
            return (
              <li key={t.id}>
                {row(t, tops)}
                {kids.length > 0 && !collapsed.has(t.id) && (
                  <ul aria-label={`Subcategories of ${t.name}`} className="border-t border-border/50 bg-muted/25">
                    {kids.map((k) => <li key={k.id}>{row(k, kids)}</li>)}
                    <li>
                      <button type="button" onClick={() => setCreating({ parentId: t.id })} className="flex min-h-10 w-full cursor-pointer items-center gap-2 pl-9 text-left text-xs text-muted-foreground transition-colors hover:text-foreground">
                        <Plus className="h-3.5 w-3.5" /> Add to {t.name}
                      </button>
                    </li>
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </Panel>

      <Dialog open={!!creating || !!editing} onOpenChange={(o) => { if (!o) { setCreating(null); setEditing(null); } }}>
        <DialogContent className="sm:max-w-md">
          {(creating || editing) && (
            <CategoryForm
              key={editing?.id ?? `new:${creating?.parentId ?? TOP}`}
              category={editing}
              initialParent={creating?.parentId ?? null}
              parents={tops}
              hasChildren={!!editing && childrenOf(editing.id).length > 0}
              onClose={() => { setCreating(null); setEditing(null); }}
              onSaved={load}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }}>
        <DialogContent className="sm:max-w-md">
          {deleting && <DeleteForm key={deleting.id} category={deleting} categories={cats} onClose={() => setDeleting(null)} onDeleted={load} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Create or edit. Remounted per category, so its fields start from the props. */
function CategoryForm({
  category,
  initialParent,
  parents,
  hasChildren,
  onClose,
  onSaved,
}: {
  category: CategoryItem | null;
  initialParent: string | null;
  parents: CategoryItem[];
  hasChildren: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(category?.name ?? "");
  const [parentId, setParentId] = useState<string | null>(category ? category.parentId : initialParent);
  const [color, setColor] = useState<string | null>(category?.color ?? null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (category) {
        await api(`/api/budget/categories/${category.id}`, { method: "PATCH", body: { name: name.trim(), parentId, color } });
        toast.success(`${name.trim()} saved. Its transactions and budgets are unchanged.`);
      } else {
        await api("/api/categories", { body: { name: name.trim(), parentId, color } });
        toast.success(parentId ? `${name.trim()} added under ${parents.find((p) => p.id === parentId)?.name}.` : `${name.trim()} added.`);
      }
      onClose();
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const choices = parents.filter((p) => p.id !== category?.id);
  return (
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{category ? `Edit ${category.name}` : parentId ? "New subcategory" : "New category"}</DialogTitle>
            <DialogDescription>
              {category ? "Renaming or moving a category keeps every transaction, schedule and budget line it has." : "Subcategories are optional: budget a whole category, or split it."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="cat-name">Name</Label>
            <Input id="cat-name" autoFocus required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder={parentId ? "e.g. Dairy" : "e.g. Groceries"} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cat-parent">Sits</Label>
            {hasChildren ? (
              <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">At the top level. It has subcategories, so it can&apos;t go under another category.</p>
            ) : (
              <ParentSelect id="cat-parent" value={parentId} onChange={setParentId} parents={choices} />
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Colour</Label>
            <ColorPicker value={color} onChange={setColor} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy || !name.trim()}>{busy ? "Saving…" : category ? "Save" : "Add"}</Button>
          </DialogFooter>
        </form>
  );
}

/** Delete, with what the category holds shown first. Remounted per category. */
function DeleteForm({ category, categories, onClose, onDeleted }: { category: CategoryItem; categories: CategoryItem[]; onClose: () => void; onDeleted: () => void }) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [target, setTarget] = useState("");
  const [mode, setMode] = useState<"move" | "drop">("move");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api<{ usage: Usage }>(`/api/budget/categories/${category.id}`)
      .then((d) => alive && setUsage(d.usage))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [category.id]);
  const history = usage ? usage.expenses + usage.schedules + usage.ledgerEntries : 0;
  const needsTarget = !!usage && (history > 0 || (usage.budgetLines > 0 && mode === "move"));
  const isLoanCategory = !!usage?.loans.length;
  const options = categories.filter((c) => c.id !== category.id);

  async function confirm() {
    setBusy(true);
    try {
      const r = await api<{ movedTo: string | null; subcategoriesMovedUp: number }>(`/api/budget/categories/${category.id}`, {
        method: "DELETE",
        body: needsTarget ? { reassignTo: target } : usage?.budgetLines ? { dropBudgets: true } : {},
      });
      toast.success(`${category.name} deleted.${r.movedTo ? ` Everything it held is now in ${r.movedTo}.` : ""}${r.subcategoriesMovedUp ? ` ${plural(r.subcategoriesMovedUp, "subcategory", "subcategories")} moved to the top level.` : ""}`);
      onClose();
      onDeleted();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
        <DialogHeader>
          <DialogTitle>Delete {category.name}?</DialogTitle>
          <DialogDescription>Transactions are never deleted with a category. Anything filed under it moves to the category you choose, with its amounts and dates unchanged.</DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-negative">{error}</p>
        ) : !usage ? (
          <SkeletonBlock className="h-20" />
        ) : isLoanCategory ? (
          <p className="rounded-lg bg-muted/60 px-3 py-2.5 text-sm">
            This is where <b>{usage.loans[0].name}</b> books its EMIs, so it can&apos;t be deleted on its own. It goes away when the loan is deleted. You can still rename it or move it under another category.
          </p>
        ) : (
          <div className="space-y-4 text-sm">
            {history === 0 && usage.budgetLines === 0 ? (
              <p className="text-muted-foreground">Nothing is filed under it yet.</p>
            ) : (
              <ul className="space-y-1 rounded-lg bg-muted/50 px-3 py-2.5 text-[13px]">
                {usage.expenses > 0 && <li>{plural(usage.expenses, "expense")}</li>}
                {usage.ledgerEntries > 0 && <li>{plural(usage.ledgerEntries, "ledger entry", "ledger entries")} (expenses, bills, EMIs)</li>}
                {usage.schedules > 0 && <li>{plural(usage.schedules, "scheduled payment")}</li>}
                {usage.budgetLines > 0 && <li>{plural(usage.budgetLines, "budget line")}{usage.fundedBudgetLines ? `, ${usage.fundedBudgetLines} with funding` : ""}</li>}
              </ul>
            )}
            {usage.budgetLines > 0 && history === 0 && (
              <fieldset className="grid gap-2">
                <legend className="sr-only">Its budget lines</legend>
                {(["move", "drop"] as const).map((m) => (
                  <label key={m} className={cn("flex cursor-pointer gap-2.5 rounded-lg border p-3", mode === m ? "border-foreground/40 bg-card shadow-card" : "border-border")}>
                    <input type="radio" className="mt-0.5 accent-[var(--brass)]" checked={mode === m} onChange={() => setMode(m)} />
                    <span>{m === "move" ? "Move its budget lines to another category" : "Remove its lines from those budgets"}<span className="block text-xs text-muted-foreground">{m === "move" ? "Amounts and funding go with them. Where the month already budgets that category, the two lines are added together." : "Only the plans change. Nothing was spent under it."}</span></span>
                  </label>
                ))}
              </fieldset>
            )}
            {needsTarget && (
              <div className="space-y-1.5">
                <Label>Move everything to</Label>
                <Select value={target} onValueChange={setTarget}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Choose a category" /></SelectTrigger>
                  <SelectContent>
                    {options.map((c) => <SelectItem key={c.id} value={c.id}>{c.depth ? `${c.parentName} › ${c.name}` : c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            {usage.subcategories.length > 0 && (
              <p className="text-xs text-muted-foreground">Its subcategories ({usage.subcategories.map((s) => s.name).join(", ")}) move to the top level and keep everything they hold.</p>
            )}
            {usage.recurring && needsTarget && <p className="text-xs text-muted-foreground">It repeats every month; the category you move it to will repeat instead (unless it already does).</p>}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{isLoanCategory ? "Close" : "Cancel"}</Button>
          {!isLoanCategory && (
            <Button variant="destructive" disabled={busy || !usage || (needsTarget && !target)} onClick={confirm}>
              {busy ? "Deleting…" : needsTarget ? "Move and delete" : "Delete"}
            </Button>
          )}
        </DialogFooter>
    </>
  );
}
