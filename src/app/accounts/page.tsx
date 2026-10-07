"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useSession } from "@/context/SessionContext";
import { api } from "@/lib/client";
import { formatMoney, SUPPORTED_CURRENCIES } from "@/lib/currencies";
import { PageHeader, Section, EmptyState, SkeletonBlock, ErrorState } from "@/components/app/PageHeader";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Equivalent } from "@/components/app/Money";
import { TransfersPanel } from "@/components/accounts/TransfersPanel";
import { useCurrency } from "@/context/CurrencyContext";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ConfirmAction } from "@/components/ConfirmAction";
import { CloseAccountDialog } from "@/components/accounts/CloseAccountDialog";
import { ACCOUNT_GROUPS, ACCOUNT_KINDS, kindOf, isCredit } from "@/components/accounts/account-kinds";
import { ArrowLeftRight, ChevronDown, Landmark, MoreHorizontal, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface Account {
  id: string;
  name: string;
  bankName: string | null;
  branchName: string | null;
  accountNumber: string | null;
  currency: string;
  accountType: string;
  currentBalance: string;
  openingBalance: string;
  creditLimit: string | null;
  notes: string | null;
  status: "ACTIVE" | "ARCHIVED" | "CLOSED";
  closedAt: string | null;
}

const mask = (n: string | null) => (n ? `•••• ${n.slice(-4)}` : null);

function AccountCard({ a, onEdit, onArchive, onClose }: { a: Account; onEdit: () => void; onArchive: () => void; onClose: () => void }) {
  const k = kindOf(a.accountType);
  const Icon = k.icon;
  const bal = Number(a.currentBalance);
  const credit = isCredit(a.accountType);
  const limit = a.creditLimit != null ? Number(a.creditLimit) : null;
  const used = credit && limit ? Math.min(100, (Math.max(-bal, 0) / limit) * 100) : null;
  return (
    <div className="lift group relative flex flex-col rounded-xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
          </div>
          <div className="min-w-0">
            <Link href={`/accounts/${a.id}`} className="block truncate font-medium after:absolute after:inset-0 hover:underline">
              {a.name}
            </Link>
            <p className="truncate text-xs text-muted-foreground">{[a.bankName, k.label].filter(Boolean).join(" · ")}</p>
          </div>
        </div>
        {a.status !== "CLOSED" && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="relative z-10 -mr-2 -mt-1" aria-label={`Actions for ${a.name}`}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem asChild><Link href={`/accounts/${a.id}`}>Statement</Link></DropdownMenuItem>
              <DropdownMenuItem asChild><Link href={`/accounts?tab=transfers&new=1&from=${a.id}`}>Transfer from here</Link></DropdownMenuItem>
              <DropdownMenuItem onClick={onEdit}>Edit details</DropdownMenuItem>
              <DropdownMenuItem onClick={onArchive}>{a.status === "ARCHIVED" ? "Restore to active" : "Archive (hide)"}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onClose}>Close account…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="mt-6 flex items-end justify-between gap-3">
        <div>
          <p className="eyebrow">{credit ? (bal < 0 ? "Owed" : "Balance") : "Balance"}</p>
          <p className={cn("mt-1 text-[1.6rem] font-semibold tabular-nums tracking-[-0.02em]", bal < 0 && !credit && "text-negative")}>
            {formatMoney(credit && bal < 0 ? -bal : bal, a.currency)}
          </p>
          <Equivalent value={credit && bal < 0 ? -bal : bal} currency={a.currency} className="text-xs" />
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {a.status === "ARCHIVED" && <StatusBadge tone="neutral">Archived</StatusBadge>}
          {a.status === "CLOSED" && <StatusBadge tone="neutral">Closed {a.closedAt ? new Date(a.closedAt).toLocaleDateString("en-IN", { month: "short", year: "numeric" }) : ""}</StatusBadge>}
          {a.accountNumber && <span className="font-mono text-[11px] text-muted-foreground">{mask(a.accountNumber)}</span>}
        </div>
      </div>
      {used != null && (
        <div className="mt-4">
          <div className="h-1 overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full", used > 80 ? "bg-negative" : used > 50 ? "bg-warning" : "bg-foreground/60")} style={{ width: `${used}%` }} />
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">{used.toFixed(0)}% of {formatMoney(limit!, a.currency)} limit used</p>
        </div>
      )}
    </div>
  );
}

type FormState = {
  accountType: string;
  name: string;
  bankName: string;
  branchName: string;
  accountNumber: string;
  currency: string;
  openingBalance: string;
  creditLimit: string;
  notes: string;
};

export default function AccountsPage() {
  const { user } = useSession();
  const search = useSearchParams();
  const router = useRouter();
  const fx = useCurrency();
  const tab = search.get("tab") === "transfers" ? "transfers" : "accounts";
  const base = user?.baseCurrency || "INR";
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const blank: FormState = { accountType: "SAVINGS", name: "", bankName: "", branchName: "", accountNumber: "", currency: base, openingBalance: "", creditLimit: "", notes: "" };
  const [form, setForm] = useState<FormState>(blank);
  const [saving, setSaving] = useState(false);

  const [editing, setEditing] = useState<Account | null>(null);
  const [edit, setEdit] = useState<FormState>(blank);
  const [closing, setClosing] = useState<Account | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const d = await api<{ accounts: Account[] }>("/api/accounts?includeClosed=1");
      setAccounts(d.accounts);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (search.get("new") === "1" && search.get("tab") !== "transfers") setCreateOpen(true);
  }, [search]);

  const open = useMemo(() => (accounts ?? []).filter((a) => a.status === "ACTIVE"), [accounts]);
  const archived = useMemo(() => (accounts ?? []).filter((a) => a.status === "ARCHIVED"), [accounts]);
  const closed = useMemo(() => (accounts ?? []).filter((a) => a.status === "CLOSED"), [accounts]);

  const totals = useMemo(() => {
    const t: Record<string, { assets: number; owed: number }> = {};
    for (const a of [...open, ...archived]) {
      const v = Number(a.currentBalance);
      t[a.currency] ??= { assets: 0, owed: 0 };
      if (v >= 0) t[a.currency].assets += v;
      else t[a.currency].owed -= v;
    }
    return t;
  }, [open, archived]);
  const primaryTotal = useMemo(() => {
    let sum = 0;
    for (const a of [...open, ...archived]) {
      const v = fx.toPrimaryAmount(Number(a.currentBalance), a.currency);
      if (v == null) return null;
      sum += v;
    }
    return sum;
  }, [open, archived, fx]);

  function chooseKind(type: string) {
    setForm({ ...blank, accountType: type, currency: type === "FOREX_CARD" ? (base === "USD" ? "EUR" : "USD") : base });
    setStep(2);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const opening = Number(form.openingBalance || 0);
      await api("/api/accounts", {
        body: {
          name: form.name,
          bankName: form.bankName,
          branchName: form.branchName,
          accountNumber: form.accountNumber || undefined,
          currency: form.currency,
          accountType: form.accountType,
          // A card's "amount owed" is entered as a positive number but is a
          // negative balance in the ledger.
          openingBalance: isCredit(form.accountType) ? -Math.abs(opening) : opening,
          creditLimit: form.creditLimit ? Number(form.creditLimit) : undefined,
          notes: form.notes,
        },
      });
      toast.success(`${form.name} added.`);
      setCreateOpen(false);
      setStep(1);
      setForm(blank);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function startEdit(a: Account) {
    setEditing(a);
    setEdit({
      accountType: a.accountType,
      name: a.name,
      bankName: a.bankName ?? "",
      branchName: a.branchName ?? "",
      accountNumber: a.accountNumber ?? "",
      currency: a.currency,
      openingBalance: String(Number(a.openingBalance)),
      creditLimit: a.creditLimit ? String(Number(a.creditLimit)) : "",
      notes: a.notes ?? "",
    });
  }

  async function saveEdit() {
    if (!editing) return;
    setSaving(true);
    try {
      await api(`/api/accounts/${editing.id}`, {
        method: "PATCH",
        body: {
          name: edit.name,
          bankName: edit.bankName,
          branchName: edit.branchName,
          accountNumber: edit.accountNumber,
          notes: edit.notes,
          creditLimit: edit.creditLimit ? Number(edit.creditLimit) : null,
          ...(Number(edit.openingBalance) !== Number(editing.openingBalance) ? { openingBalance: Number(edit.openingBalance), openingBalanceReason: "Corrected from account settings" } : {}),
        },
      });
      toast.success("Account updated.");
      setEditing(null);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleArchive(a: Account) {
    try {
      await api(`/api/accounts/${a.id}`, { method: "PATCH", body: { status: a.status === "ARCHIVED" ? "ACTIVE" : "ARCHIVED" } });
      toast.success(a.status === "ARCHIVED" ? `${a.name} is active again.` : `${a.name} archived. Its balance still counts.`);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const kind = kindOf(form.accountType);
  const credit = isCredit(form.accountType);
  const openingChanged = editing && Number(edit.openingBalance) !== Number(editing.openingBalance);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Accounts"
        description="Every account and card you hold. Each balance always matches its history."
        actions={
          <>
            <Button variant="outline" asChild><Link href="/accounts?tab=transfers&new=1"><ArrowLeftRight /> Transfer</Link></Button>
            <Button onClick={() => { setStep(1); setCreateOpen(true); }}><Plus /> Add account</Button>
          </>
        }
      />

      {error && <ErrorState message={error} onRetry={load} />}

      <div className="settle flex gap-1 border-b border-border" role="tablist">
        {(["accounts", "transfers"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => router.replace(t === "accounts" ? "/accounts" : "/accounts?tab=transfers", { scroll: false })}
            className={cn("relative -mb-px h-10 cursor-pointer px-3 text-sm transition-colors", tab === t ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {t === "accounts" ? "Accounts & cards" : "Transfers"}
            {tab === t && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brass" />}
          </button>
        ))}
      </div>

      {tab === "transfers" ? <TransfersPanel onChanged={load} /> : <>
      {accounts && Object.keys(totals).length > 0 && (
        <div className="settle flex flex-wrap gap-x-10 gap-y-4 border-y border-border py-4">
          {Object.entries(totals).map(([cur, t]) => (
            <div key={cur} className="flex gap-8">
              <div>
                <p className="eyebrow">Held · {cur}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">{formatMoney(t.assets, cur)}</p>
              </div>
              {t.owed > 0 && (
                <div>
                  <p className="eyebrow">Owed on cards · {cur}</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-negative">{formatMoney(t.owed, cur)}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!accounts && !error ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <SkeletonBlock key={i} className="h-40" />)}</div>
      ) : accounts && open.length + archived.length === 0 ? (
        <EmptyState
          icon={<Landmark className="h-5 w-5" />}
          title="No accounts yet"
          action={<Button onClick={() => setCreateOpen(true)}><Plus /> Add your first account</Button>}
        >
          Start with the account your pay lands in. Cards and cash can follow.
        </EmptyState>
      ) : (
        ACCOUNT_GROUPS.map((g) => {
          const items = [...open, ...archived].filter((a) => kindOf(a.accountType).group === g.key);
          if (!items.length) return null;
          return (
            <Section key={g.key} title={g.label}>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((a) => (
                  <AccountCard key={a.id} a={a} onEdit={() => startEdit(a)} onArchive={() => toggleArchive(a)} onClose={() => setClosing(a)} />
                ))}
              </div>
            </Section>
          );
        })
      )}

      {primaryTotal != null && Object.keys(totals).length > 1 && (
        <p className="settle -mt-4 text-xs text-muted-foreground">
          All together ≈ <span className="font-medium text-foreground tabular-nums">{formatMoney(Math.round(primaryTotal), fx.primary)}</span> at today&apos;s rates.
        </p>
      )}

      {closed.length > 0 && (
        <section className="settle">
          <button onClick={() => setShowClosed((s) => !s)} className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ChevronDown className={cn("h-4 w-4 transition-transform", showClosed && "rotate-180")} />
            Closed accounts ({closed.length}), history kept
          </button>
          {showClosed && (
            <div className="mt-4 grid gap-4 opacity-80 sm:grid-cols-2 lg:grid-cols-3">
              {closed.map((a) => <AccountCard key={a.id} a={a} onEdit={() => {}} onArchive={() => {}} onClose={() => {}} />)}
            </div>
          )}
        </section>
      )}
      </>}

      {/* Create */}
      <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) setStep(1); }}>
        <DialogContent className="sm:max-w-lg">
          {step === 1 ? (
            <>
              <DialogHeader>
                <DialogTitle>What are you adding?</DialogTitle>
                <DialogDescription>Pick a type and the form adjusts to it.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-2 sm:grid-cols-2">
                {ACCOUNT_KINDS.map((k) => {
                  const Icon = k.icon;
                  return (
                    <button
                      key={k.type}
                      onClick={() => chooseKind(k.type)}
                      className="group flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-foreground/30 hover:bg-muted/50"
                    >
                      <Icon className="mt-0.5 h-[18px] w-[18px] text-muted-foreground group-hover:text-foreground" strokeWidth={1.75} />
                      <span>
                        <span className="block text-sm font-medium">{k.label}</span>
                        <span className="block text-xs text-muted-foreground">{k.hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <form onSubmit={create} className="space-y-4">
              <DialogHeader>
                <DialogTitle>New {kind.label.toLowerCase()}</DialogTitle>
                <DialogDescription>
                  <button type="button" className="cursor-pointer underline underline-offset-2" onClick={() => setStep(1)}>Change type</button>
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-1.5">
                <Label htmlFor="a-name">Name</Label>
                <Input id="a-name" required autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={credit ? "HDFC Millennia" : form.accountType === "FOREX_CARD" ? "Niyo Global (USD)" : form.accountType === "CASH_WALLET" ? "Wallet" : "SBI Savings"} />
              </div>
              {kind.group !== "wallet" && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="a-bank">{(kind.group === "credit" || kind.group === "prepaid") ? "Issuer" : "Bank"}</Label>
                    <Input id="a-bank" value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} placeholder="Optional" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="a-num">{(kind.group === "credit" || kind.group === "prepaid") ? "Last 4 digits" : "Account number"}</Label>
                    <Input id="a-num" inputMode="numeric" value={form.accountNumber} onChange={(e) => setForm({ ...form, accountNumber: e.target.value })} placeholder="Optional" />
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Currency</Label>
                  <Select value={form.currency} onValueChange={(v) => setForm({ ...form, currency: v })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SUPPORTED_CURRENCIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.code} · {c.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="a-open">{credit ? "Amount owed today" : "Balance today"}</Label>
                  <Input id="a-open" type="number" inputMode="decimal" step="0.01" min={credit ? 0 : undefined} value={form.openingBalance} onChange={(e) => setForm({ ...form, openingBalance: e.target.value })} placeholder="0" />
                </div>
              </div>
              {(credit || form.accountType === "PREPAID_CARD") && credit && (
                <div className="space-y-1.5">
                  <Label htmlFor="a-limit">Credit limit</Label>
                  <Input id="a-limit" type="number" inputMode="decimal" min="0" step="1" value={form.creditLimit} onChange={(e) => setForm({ ...form, creditLimit: e.target.value })} placeholder="Optional. We'll warn you before you go over." />
                </div>
              )}
              {form.accountType === "FOREX_CARD" && (
                <p className="rounded-lg bg-info-soft px-3 py-2 text-xs text-info">
                  Top it up with a transfer from a bank account. You&apos;ll enter what left the bank and the {form.currency} that arrived.
                </p>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={saving || !form.name.trim()}>{saving ? "Adding…" : "Add account"}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit {editing?.name}</DialogTitle>
            <DialogDescription>Type and currency are fixed once an account has a ledger.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="e-name">Name</Label>
              <Input id="e-name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="e-bank">Bank / issuer</Label>
                <Input id="e-bank" value={edit.bankName} onChange={(e) => setEdit({ ...edit, bankName: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="e-num">Number</Label>
                <Input id="e-num" value={edit.accountNumber} onChange={(e) => setEdit({ ...edit, accountNumber: e.target.value })} />
              </div>
            </div>
            {editing && isCredit(editing.accountType) && (
              <div className="space-y-1.5">
                <Label htmlFor="e-limit">Credit limit</Label>
                <Input id="e-limit" type="number" min="0" value={edit.creditLimit} onChange={(e) => setEdit({ ...edit, creditLimit: e.target.value })} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="e-open">Opening balance</Label>
              <Input id="e-open" type="number" step="0.01" value={edit.openingBalance} onChange={(e) => setEdit({ ...edit, openingBalance: e.target.value })} />
              <p className="text-xs text-muted-foreground">Only to fix a typo from when the account was added. The difference is posted as a dated adjustment; the original stays on the statement.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="e-notes">Notes</Label>
              <Input id="e-notes" value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            {openingChanged ? (
              <ConfirmAction
                destructive={false}
                title="Correct the opening balance?"
                description={
                  editing && (
                    <p>
                      {formatMoney(editing.openingBalance, editing.currency)} → {formatMoney(edit.openingBalance || 0, editing.currency)}. Your current balance moves by{" "}
                      {formatMoney(Number(edit.openingBalance) - Number(editing.openingBalance), editing.currency)}, recorded as an adjustment dated today.
                    </p>
                  )
                }
                confirmLabel="Post correction"
                onConfirm={saveEdit}
                trigger={<Button disabled={saving}>Save…</Button>}
              />
            ) : (
              <Button onClick={saveEdit} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CloseAccountDialog
        account={closing}
        accounts={accounts ?? []}
        open={!!closing}
        onOpenChange={(o) => !o && setClosing(null)}
        onClosed={load}
      />
    </div>
  );
}
