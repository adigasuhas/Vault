"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { api, localToday } from "@/lib/client";
import { formatMoney, SUPPORTED_CURRENCIES } from "@/lib/currencies";
import { formatDate } from "@/lib/format";
import { PageHeader, Panel, Section, EmptyState, SkeletonBlock, ErrorState } from "@/components/app/PageHeader";
import { Money } from "@/components/app/Money";
import { StatusBadge, type Tone } from "@/components/app/StatusBadge";
import { LoanDialog } from "@/components/loans/LoanDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ConfirmAction } from "@/components/ConfirmAction";
import { FxTicker } from "@/components/app/FxTicker";
import { MoreHorizontal, NotebookPen, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface Entry {
  id: string;
  title: string;
  amount: string;
  currency: string;
  date: string;
  paidBy: "ME" | "OTHER";
  person: string | null;
  notes: string | null;
  status: "OPEN" | "CONVERTED";
  convertedTo: "LOAN" | "EXPENSE" | "RECEIVABLE" | null;
  convertedId: string | null;
  sourceExpenseId: string | null;
  project: { id: string; name: string } | null;
}
interface Project { id: string; name: string; archivedAt: string | null; count: number; byCurrency: { currency: string; amount: number }[]; total: number | null; lastDate: string | null }
interface Account { id: string; name: string; currency: string; status: string }
interface Category { id: string; name: string }

const NO_GROUP = "__none__";
const NEW_GROUP = "__new_group__";

const CONVERTED: Record<NonNullable<Entry["convertedTo"]>, { label: string; tone: Tone; href: (e: Entry) => string }> = {
  LOAN: { label: "Turned into a loan", tone: "brass", href: (e) => `/loans/${e.convertedId}` },
  EXPENSE: { label: "Logged as an expense", tone: "neutral", href: () => "/expenses" },
  RECEIVABLE: { label: "Expected back", tone: "info", href: () => "/receivables" },
};

function sumByCurrency(entries: Entry[]) {
  const m = new Map<string, number>();
  for (const e of entries) m.set(e.currency, (m.get(e.currency) ?? 0) + Number(e.amount));
  return [...m.entries()];
}
const showTotals = (t: [string, number][]) => (t.length ? t.map(([cur, v]) => formatMoney(v, cur)).join(" + ") : "—");

/** Add or edit an entry. */
function EntryDialog({
  open,
  onOpenChange,
  initial,
  projects,
  defaultCurrency,
  defaultProjectId,
  onProjectCreated,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial: Entry | null;
  projects: Project[];
  defaultCurrency: string;
  defaultProjectId: string | null;
  onProjectCreated: (p: Project) => void;
  onSaved: () => void;
}) {
  const blank = () => ({
    title: initial?.title ?? "",
    amount: initial ? String(Number(initial.amount)) : "",
    currency: initial?.currency ?? defaultCurrency,
    date: initial?.date.slice(0, 10) ?? localToday(),
    paidBy: initial?.paidBy ?? ("ME" as "ME" | "OTHER"),
    person: initial?.person ?? "",
    notes: initial?.notes ?? "",
    projectId: initial ? (initial.project?.id ?? NO_GROUP) : (defaultProjectId ?? NO_GROUP),
  });
  const [f, setF] = useState(blank);
  const [newGroup, setNewGroup] = useState("");
  const [busy, setBusy] = useState(false);
  // Which entry this form edits, fixed when it opens: saving an edit always
  // updates that entry, never adds another one.
  const [editingId, setEditingId] = useState<string | null>(initial?.id ?? null);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setF(blank());
      setNewGroup("");
      setEditingId(initial?.id ?? null);
    }
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    try {
      let projectId: string | null = f.projectId === NO_GROUP ? null : f.projectId;
      if (f.projectId === NEW_GROUP) {
        const r = await api<{ project: Project }>("/api/expense-projects", { body: { name: newGroup.trim() } });
        onProjectCreated({ ...r.project, count: 0, byCurrency: [], total: 0, lastDate: null });
        projectId = r.project.id;
      }
      const body = {
        title: f.title.trim(),
        amount: Number(f.amount),
        currency: f.currency,
        date: f.date,
        paidBy: f.paidBy,
        person: f.person.trim() || null,
        notes: f.notes.trim() || null,
        projectId,
      };
      if (editingId) await api(`/api/notebook/${editingId}`, { method: "PATCH", body });
      else await api("/api/notebook", { body });
      toast.success(editingId ? "Entry updated." : `${body.title} added to your notebook.`);
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const valid = f.title.trim() && Number(f.amount) > 0 && f.date && (f.projectId !== NEW_GROUP || newGroup.trim());
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit entry" : "Add to notebook"}</DialogTitle>
            <DialogDescription>Just a note. It doesn&apos;t touch your balances, outflow or budget until you turn it into something.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="n-title">What was it?</Label>
            <Input id="n-title" autoFocus required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Flights home, laptop, deposit…" />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1.2fr_0.8fr_1fr]">
            <div className="space-y-1.5">
              <Label htmlFor="n-amt">Amount</Label>
              <Input id="n-amt" type="number" inputMode="decimal" min="0" step="0.01" required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Currency</Label>
              <Select value={f.currency} onValueChange={(v) => setF({ ...f, currency: v })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{SUPPORTED_CURRENCIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1.5 sm:col-span-1">
              <Label htmlFor="n-date">Date</Label>
              <Input id="n-date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
            </div>
          </div>
          {f.currency !== defaultCurrency && <FxTicker />}
          <div className="space-y-1.5">
            <Label>Who paid?</Label>
            <div className="grid grid-cols-2 gap-2" role="radiogroup">
              {(["ME", "OTHER"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={f.paidBy === p}
                  onClick={() => setF({ ...f, paidBy: p })}
                  className={cn("min-h-10 cursor-pointer rounded-md border px-2 py-1.5 text-sm leading-tight transition-colors", f.paidBy === p ? "border-foreground/50 bg-muted font-medium" : "border-border text-muted-foreground hover:text-foreground")}
                >
                  {p === "ME" ? "I did" : "Someone else, for me"}
                </button>
              ))}
            </div>
            {editingId && initial && f.paidBy !== initial.paidBy && (
              <p className="text-xs text-muted-foreground">
                The whole {formatMoney(Number(f.amount) || 0, f.currency)} moves from {initial.paidBy === "ME" ? "Paid by you" : "Paid for you by others"} to {f.paidBy === "ME" ? "Paid by you" : "Paid for you by others"}. It&apos;s still one entry.
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="n-person">{f.paidBy === "OTHER" ? "Who paid it" : "For / with whom"} <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Input id="n-person" value={f.person} onChange={(e) => setF({ ...f, person: e.target.value })} placeholder={f.paidBy === "OTHER" ? "Dad, Priya…" : "Shared with…"} />
            </div>
            <div className="space-y-1.5">
              <Label>Group</Label>
              <Select value={f.projectId} onValueChange={(v) => setF({ ...f, projectId: v })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_GROUP}>No group</SelectItem>
                  {projects.filter((p) => !p.archivedAt || p.id === f.projectId).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  <SelectSeparator />
                  <SelectItem value={NEW_GROUP}>New group…</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {f.projectId === NEW_GROUP && (
            <Input autoFocus value={newGroup} onChange={(e) => setNewGroup(e.target.value)} placeholder="Group name, e.g. Liverpool move" aria-label="New group name" />
          )}
          <div className="space-y-1.5">
            <Label htmlFor="n-notes">Notes <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Input id="n-notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Pay back by March, split 50/50…" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy || !valid}>{busy ? "Saving…" : editingId ? "Save" : "Add entry"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Turn an entry into a real expense, or into money expected back. */
function ConvertDialog({
  entry,
  mode,
  onOpenChange,
  accounts,
  categories,
  onDone,
}: {
  entry: Entry | null;
  mode: "EXPENSE" | "RECEIVABLE";
  onOpenChange: (o: boolean) => void;
  accounts: Account[];
  categories: Category[];
  onDone: () => void;
}) {
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [shownFor, setShownFor] = useState<string | null>(null);
  const key = entry ? `${entry.id}:${mode}` : null;
  if (key !== shownFor) {
    setShownFor(key);
    if (entry) {
      setAccountId("");
      setCategoryId("");
      setDate(mode === "EXPENSE" ? entry.date.slice(0, 10) : localToday());
    }
  }
  const sameCur = accounts.filter((a) => entry && a.currency === entry.currency && a.status !== "CLOSED");

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!entry) return;
    setBusy(true);
    try {
      await api(`/api/notebook/${entry.id}/convert`, { body: mode === "EXPENSE" ? { to: "EXPENSE", accountId, categoryId, date } : { to: "RECEIVABLE", accountId, date } });
      toast.success(mode === "EXPENSE" ? `${entry.title} logged as an expense.` : `${entry.title} added to Receivables. Confirm it there when the money arrives.`);
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!entry} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{mode === "EXPENSE" ? "Log as a real expense" : "Expect this money back"}</DialogTitle>
            <DialogDescription>
              {entry && (
                <>
                  {entry.title} · {formatMoney(Number(entry.amount), entry.currency)}.{" "}
                  {mode === "EXPENSE"
                    ? "It comes off the account you pick and counts in that month's outflow."
                    : `It shows up in Receivables${entry.person ? ` as owed by ${entry.person}` : ""}, and goes into the account once you confirm it's arrived.`}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>{mode === "EXPENSE" ? "Paid from" : "Paid into"}</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger className="w-full"><SelectValue placeholder={sameCur.length ? "Choose account" : `No ${entry?.currency ?? ""} accounts`} /></SelectTrigger>
              <SelectContent>{sameCur.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {mode === "EXPENSE" && (
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Choose category" /></SelectTrigger>
                <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="c-date">{mode === "EXPENSE" ? "Date paid" : "Expected on"}</Label>
            <Input id="c-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy || !accountId || !date || (mode === "EXPENSE" && !categoryId)}>
              {busy ? "Saving…" : mode === "EXPENSE" ? "Log expense" : "Add to Receivables"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function NotebookPage() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [currency, setCurrency] = useState("INR");
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState("ALL");
  const [show, setShow] = useState<"OPEN" | "ALL">("OPEN");
  const [editor, setEditor] = useState<{ open: boolean; entry: Entry | null }>({ open: false, entry: null });
  const [converting, setConverting] = useState<{ entry: Entry | null; mode: "EXPENSE" | "RECEIVABLE" }>({ entry: null, mode: "EXPENSE" });
  const [loanFrom, setLoanFrom] = useState<Entry | null>(null);
  const [deleting, setDeleting] = useState<Entry | null>(null);
  const [duplicates, setDuplicates] = useState<string[][]>([]);
  // Groups the user said are genuinely separate entries (kept on this device).
  const [dismissed, setDismissed] = useState<string[]>(() => {
    try {
      return typeof window === "undefined" ? [] : JSON.parse(localStorage.getItem("vault.notebook.notDuplicates") ?? "[]");
    } catch {
      return [];
    }
  });

  const load = useCallback(async () => {
    try {
      const [n, p] = await Promise.all([
        api<{ entries: Entry[]; currency: string; possibleDuplicates?: string[][] }>("/api/notebook"),
        api<{ projects: Project[] }>("/api/expense-projects?includeArchived=1"),
      ]);
      setEntries(n.entries);
      setDuplicates(n.possibleDuplicates ?? []);
      setCurrency(n.currency);
      setProjects(p.projects);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
    Promise.all([api<{ accounts: Account[] }>("/api/accounts"), api<{ categories: Category[] }>("/api/categories")])
      .then(([a, c]) => {
        setAccounts(a.accounts);
        setCategories(c.categories.filter((x) => !x.name.startsWith("Loan: ")));
      })
      .catch(() => {});
  }, [load]);

  const all = useMemo(() => entries ?? [], [entries]);
  const open = all.filter((e) => e.status === "OPEN");
  const visible = all.filter((e) => (show === "ALL" || e.status === "OPEN") && (group === "ALL" || (group === NO_GROUP ? !e.project : e.project?.id === group)));
  const activeProjects = projects.filter((p) => !p.archivedAt);
  const byId = new Map(all.map((e) => [e.id, e]));
  const toReview = duplicates.filter((g) => !dismissed.includes(g.join(","))).map((g) => g.map((id) => byId.get(id)).filter((e): e is Entry => !!e)).filter((g) => g.length > 1);
  function keepBoth(group: Entry[]) {
    const next = [...dismissed, group.map((e) => e.id).join(",")];
    setDismissed(next);
    try {
      localStorage.setItem("vault.notebook.notDuplicates", JSON.stringify(next));
    } catch {}
  }

  async function remove(e: Entry) {
    try {
      await api(`/api/notebook/${e.id}`, { method: "DELETE" });
      toast.success(`Deleted ${e.title}.`);
      load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Notebook"
        description="Jot down money spent outside your monthly routine, whether you paid or someone paid for you. Nothing here touches your balances, outflow or budget. When it's settled how it'll be paid, turn an entry into a loan, an expense or money you're owed."
        actions={<Button onClick={() => setEditor({ open: true, entry: null })}><Plus /> Add entry</Button>}
      />
      {error && <ErrorState message={error} onRetry={load} />}

      {entries && entries.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Panel>
            <p className="text-xs text-muted-foreground">Open entries</p>
            <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight">{showTotals(sumByCurrency(open))}</p>
            <p className="mt-1 text-xs text-muted-foreground">{open.length} {open.length === 1 ? "entry" : "entries"} not turned into anything yet</p>
          </Panel>
          <Panel>
            <p className="text-xs text-muted-foreground">Paid for you by others</p>
            <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight">{showTotals(sumByCurrency(open.filter((e) => e.paidBy === "OTHER")))}</p>
            <p className="mt-1 text-xs text-muted-foreground">Turn these into loans if you&apos;ll pay them back</p>
          </Panel>
          <Panel>
            <p className="text-xs text-muted-foreground">Paid by you</p>
            <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight">{showTotals(sumByCurrency(open.filter((e) => e.paidBy === "ME")))}</p>
            <p className="mt-1 text-xs text-muted-foreground">Log as an expense, or expect it back</p>
          </Panel>
        </div>
      )}

      {toReview.length > 0 && (
        <Panel className="settle space-y-3 border-warning/40">
          <div>
            <p className="text-sm font-medium">{toReview.length === 1 ? "These look like the same entry" : `${toReview.length} entries look written down twice`}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Same title, amount and date. Each copy counts in the totals above, so the amount can show as paid by you and by someone else. Delete the copy you don&apos;t need, or keep both if they really are separate.
            </p>
          </div>
          {toReview.map((group) => (
            <div key={group.map((e) => e.id).join(",")} className="rounded-lg border border-border">
              <ul className="divide-y divide-border/70">
                {group.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                    <span className="min-w-0 basis-full sm:flex-1 sm:basis-auto sm:truncate">{e.title} <span className="text-muted-foreground">· {formatDate(e.date, { day: "numeric", month: "short", year: "numeric" })} · {e.paidBy === "OTHER" ? `paid by ${e.person || "someone else"}` : "paid by you"}</span></span>
                    <Money value={Number(e.amount)} currency={e.currency} tone="plain" className="font-medium" />
                    <Button size="sm" variant="outline" className="ml-auto sm:ml-0" onClick={() => setDeleting(e)}>Delete this one</Button>
                  </li>
                ))}
              </ul>
              <div className="flex justify-end border-t border-border px-3 py-2">
                <Button size="sm" variant="ghost" onClick={() => keepBoth(group)}>They&apos;re separate, keep both</Button>
              </div>
            </div>
          ))}
        </Panel>
      )}

      {activeProjects.length > 0 && (
        <Section title="Groups" description="Related entries added up, so you know what the whole thing came to.">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {activeProjects.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setGroup(group === p.id ? "ALL" : p.id)}
                className={cn("cursor-pointer rounded-xl border bg-card p-4 text-left shadow-card transition-colors", group === p.id ? "border-foreground/40" : "border-border hover:border-foreground/20")}
              >
                <p className="truncate font-medium">{p.name}</p>
                <p className="mt-3 text-xl font-semibold tabular-nums tracking-tight">
                  {p.byCurrency.length === 0 ? <span className="text-base font-normal text-muted-foreground">Nothing yet</span> : p.byCurrency.length === 1 ? formatMoney(p.byCurrency[0].amount, p.byCurrency[0].currency) : p.total != null ? `≈ ${formatMoney(p.total, currency)}` : p.byCurrency.map((b) => formatMoney(b.amount, b.currency)).join(" + ")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {p.count} {p.count === 1 ? "entry" : "entries"}
                  {p.lastDate && ` · last ${formatDate(p.lastDate, { day: "numeric", month: "short", year: "numeric" })}`}
                </p>
              </button>
            ))}
          </div>
        </Section>
      )}

      <Section
        title="Entries"
        description={group === "ALL" ? "Newest first." : group === NO_GROUP ? "Entries that aren't in a group." : `Entries in ${projects.find((p) => p.id === group)?.name ?? "this group"}.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select value={group} onValueChange={setGroup}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All groups</SelectItem>
                <SelectItem value={NO_GROUP}>Not in a group</SelectItem>
                {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}{p.archivedAt ? " (archived)" : ""}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={show} onValueChange={(v) => setShow(v as "OPEN" | "ALL")}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="OPEN">Open only</SelectItem>
                <SelectItem value="ALL">Include converted</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      >
        <Panel padded={false}>
          {entries === null ? (
            <div className="space-y-2 p-5">{[0, 1, 2].map((i) => <SkeletonBlock key={i} className="h-10" />)}</div>
          ) : visible.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={<NotebookPen className="h-5 w-5" />}
                title={all.length === 0 ? "Your notebook is empty" : "Nothing to show here"}
                action={<Button size="sm" variant="outline" onClick={() => setEditor({ open: true, entry: null })}>Add an entry</Button>}
              >
                Flights a parent paid for, a deposit you covered for a flatmate, a laptop you&apos;re still deciding how to pay off. Note it here; decide later.
              </EmptyState>
            </div>
          ) : (
            <>
              <ul className="divide-y divide-border/70">
                {visible.map((e) => {
                  const conv = e.convertedTo ? CONVERTED[e.convertedTo] : null;
                  return (
                    <li key={e.id} className={cn("flex items-center gap-3 px-5 py-3", conv && "opacity-70")}>
                      <div className="w-14 shrink-0 text-xs text-muted-foreground tabular-nums">
                        {formatDate(e.date, { day: "numeric", month: "short" })}
                        <span className="block text-[10px]">{e.date.slice(0, 4)}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{e.title}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {e.project && <span className="text-foreground/80">{e.project.name} · </span>}
                          {e.paidBy === "OTHER" ? `Paid by ${e.person || "someone else"}` : e.person ? `Paid by you · ${e.person}` : "Paid by you"}
                          {e.notes && ` · ${e.notes}`}
                        </p>
                      </div>
                      {conv && (
                        <Link href={conv.href(e)} className="hidden sm:block">
                          <StatusBadge tone={conv.tone}>{conv.label}</StatusBadge>
                        </Link>
                      )}
                      <Money value={Number(e.amount)} currency={e.currency} tone="plain" className="text-sm font-medium" />
                      <div className="w-8">
                        {e.status === "OPEN" && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon-sm" aria-label={`${e.title} actions`}><MoreHorizontal className="h-4 w-4" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                              <DropdownMenuItem onClick={() => setLoanFrom(e)}>Turn into a loan…</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setConverting({ entry: e, mode: "EXPENSE" })}>Log as a real expense…</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setConverting({ entry: e, mode: "RECEIVABLE" })}>Expect it back…</DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => setEditor({ open: true, entry: e })}>Edit…</DropdownMenuItem>
                              <DropdownMenuItem variant="destructive" onClick={() => setDeleting(e)}>Delete…</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="flex justify-between gap-3 border-t border-border bg-muted/40 px-5 py-2.5 text-sm">
                <span className="text-muted-foreground">Total shown</span>
                <span className="font-medium tabular-nums">{showTotals(sumByCurrency(visible))}</span>
              </div>
            </>
          )}
        </Panel>
      </Section>

      <EntryDialog
        open={editor.open}
        onOpenChange={(o) => setEditor((s) => ({ ...s, open: o }))}
        initial={editor.entry}
        projects={projects}
        defaultCurrency={currency}
        defaultProjectId={group !== "ALL" && group !== NO_GROUP ? group : null}
        onProjectCreated={(p) => setProjects((ps) => [p, ...ps])}
        onSaved={load}
      />
      <ConvertDialog
        entry={converting.entry}
        mode={converting.mode}
        onOpenChange={(o) => !o && setConverting((s) => ({ ...s, entry: null }))}
        accounts={accounts}
        categories={categories}
        onDone={load}
      />
      <LoanDialog
        open={!!loanFrom}
        onOpenChange={(o) => !o && setLoanFrom(null)}
        onDone={() => {
          toast.success("The entry is now a loan. Find it in Loans & payments.");
          load();
        }}
        initial={loanFrom ? { name: loanFrom.person ? `${loanFrom.title} (${loanFrom.person})` : loanFrom.title, principal: Number(loanFrom.amount), currency: loanFrom.currency } : undefined}
        notebookEntryId={loanFrom?.id}
      />
      <ConfirmAction
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this entry?"
        description={deleting && <p>{deleting.title} · {formatMoney(Number(deleting.amount), deleting.currency)}. It&apos;s only a note, so nothing else changes.</p>}
        confirmLabel="Delete entry"
        onConfirm={() => remove(deleting!)}
      />
    </div>
  );
}
