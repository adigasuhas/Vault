"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Landmark, MoreHorizontal, Plus, Wallet } from "lucide-react";
import { api } from "@/lib/client";
import { formatMoney } from "@/lib/currencies";
import { formatDate } from "@/lib/format";
import { monthLabel } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { Panel, Section } from "@/components/app/PageHeader";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ConfirmAction } from "@/components/ConfirmAction";
import { STATE_LABEL, type Budget, type FundingOption, type Source } from "@/components/budget/types";

/**
 * The money a month's budget draws on: receivables (expected or received)
 * and balances set aside from accounts. Shown apart, because money that's
 * expected isn't money you have yet. Adding a source moves nothing.
 */
export function MoneySources({ data, onChanged }: { data: Budget; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Source | null>(null);
  const [removing, setRemoving] = useState<Source | null>(null);
  const c = data.currency;
  const addable = data.fundingOptions.filter((o) => !o.inPlan && o.room > 0);

  async function remove(s: Source) {
    try {
      const r = await api<{ linesUnfunded: number }>(`/api/budget/sources/${s.id}`, { method: "DELETE" });
      toast.success(`${s.label} removed from ${monthLabel(data.month, "short")}.${r.linesUnfunded ? ` ${r.linesUnfunded} line${r.linesUnfunded === 1 ? "" : "s"} lost the funding it gave.` : ""}`);
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <Section
      title={`Money for ${monthLabel(data.month)}`}
      description="The receivables and balances this month's budget draws on. Planning only: nothing here moves money or changes a balance."
      actions={<Button size="sm" variant="outline" disabled={!addable.length} onClick={() => setAdding(true)}><Plus /> Add money</Button>}
    >
      {data.sources.length === 0 ? (
        <Panel className="flex flex-wrap items-center gap-3 text-sm">
          <Wallet className="h-5 w-5 text-muted-foreground" />
          <p className="min-w-0 flex-1 text-muted-foreground">
            {addable.length
              ? "Add your stipend, salary or other receivables, or set aside part of an account balance, then give every line a source."
              : "No receivables this month or last, and no account balances to draw on. Add income in Receivables, or an account, first."}
          </p>
          {addable.length > 0 && <Button size="sm" onClick={() => setAdding(true)}>Add money</Button>}
        </Panel>
      ) : (
        <Panel padded={false} className="overflow-hidden">
          <ul className="divide-y divide-border/70">
            {data.sources.map((s) => {
              const pct = s.amount > 0 ? Math.min(100, (s.allocated / s.amount) * 100) : 0;
              const st = s.state ? STATE_LABEL[s.state] : null;
              return (
                <li key={s.id} className="px-5 py-3.5">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                      {s.kind === "RECEIVABLE" ? <Wallet className="h-4 w-4" /> : <Landmark className="h-4 w-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        <span className="truncate">{s.label}</span>
                        {st && <StatusBadge tone={st.tone}>{st.label}</StatusBadge>}
                        {s.kind === "ACCOUNT" && <StatusBadge tone="neutral" dot={false}>Balance</StatusBadge>}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {s.kind === "RECEIVABLE"
                          ? s.native
                            ? `${s.state === "received" ? "Received" : "Expected"} ${formatMoney(s.native.amount, s.native.currency)}${s.date ? ` · ${formatDate(s.date, { day: "numeric", month: "short" })}` : ""}${s.native.currency !== c || Math.abs(s.native.amount - s.amount) > 0.005 ? ` · ${formatMoney(s.amount, c)} counted here` : ""}`
                            : "No longer scheduled"
                          : `${formatMoney(s.amount, c)} of the balance set aside`}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium tabular-nums">{formatMoney(s.amount, c)}</p>
                      <p className={cn("text-[11px] tabular-nums", s.unallocated < -0.005 ? "text-negative" : "text-muted-foreground")}>
                        {Math.abs(s.unallocated) < 0.005 ? "all given a job" : s.unallocated > 0 ? `${formatMoney(s.unallocated, c)} unallocated` : `${formatMoney(-s.unallocated, c)} over`}
                      </p>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`More for ${s.label}`}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem disabled={!(s.scheduleId || s.accountId)} onClick={() => setEditing(s)}>Change amount…</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onClick={() => setRemoving(s)}>Remove from {monthLabel(data.month, "short")}</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="mt-2.5 ml-11 h-1.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${Math.round(pct)}% allocated`}>
                    <div className={cn("h-full transition-[width] duration-500", s.short > 0 ? "bg-warning" : "bg-brass")} style={{ width: `${pct}%` }} />
                  </div>
                  {s.note && (
                    <p className={cn("mt-2 ml-11 flex items-start gap-1.5 text-xs", s.short > 0 || s.state === "cancelled" || s.state === "gone" ? "text-warning" : "text-muted-foreground")}>
                      {(s.short > 0 || s.state === "cancelled" || s.state === "gone") && <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />}
                      {s.note}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="sm:max-w-md">{adding && <AddSource month={data.month} currency={c} options={addable} onDone={() => { setAdding(false); onChanged(); }} onCancel={() => setAdding(false)} />}</DialogContent>
      </Dialog>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-sm">
          {editing && <EditSource key={editing.id} source={editing} currency={c} room={data.fundingOptions.find((o) => o.ref && "sourceId" in o.ref && o.ref.sourceId === editing.id)?.room ?? null} onDone={() => { setEditing(null); onChanged(); }} onCancel={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>
      <ConfirmAction
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.label} from ${monthLabel(data.month, "short")}?`}
        description={<p>{removing && removing.allocated > 0 ? `Lines it funds lose ${formatMoney(removing.allocated, c)} of funding; their budgets stay as they are.` : "Nothing in this month draws on it yet."} The income and the account themselves aren&apos;t touched.</p>}
        confirmLabel="Remove"
        onConfirm={() => remove(removing!)}
      />
    </Section>
  );
}

function AddSource({ month, currency, options, onDone, onCancel }: { month: string; currency: string; options: FundingOption[]; onDone: () => void; onCancel: () => void }) {
  const [key, setKey] = useState(options[0]?.key ?? "");
  const opt = options.find((o) => o.key === key);
  const [amount, setAmount] = useState(opt && opt.kind === "RECEIVABLE" ? String(opt.room) : "");
  const [busy, setBusy] = useState(false);
  const amt = Number(amount);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!opt) return;
    setBusy(true);
    try {
      await api("/api/budget/sources", { body: { month, ...opt.ref, amount: amt > 0 ? amt : undefined } });
      toast.success(`${opt.label} added to ${monthLabel(month, "short")}. Nothing was moved.`);
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>Add money to {monthLabel(month)}</DialogTitle>
        <DialogDescription>Expected income counts once it&apos;s added, but stays marked as expected until it arrives.</DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        <Label>From</Label>
        <Select value={key} onValueChange={(k) => { setKey(k); const o = options.find((x) => x.key === k); setAmount(o && o.kind === "RECEIVABLE" ? String(o.room) : ""); }}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Choose" /></SelectTrigger>
          <SelectContent>
            {(["RECEIVABLE", "ACCOUNT"] as const).map((kind) => {
              const list = options.filter((o) => o.kind === kind);
              if (!list.length) return null;
              return (
                <SelectGroup key={kind}>
                  <SelectLabel>{kind === "RECEIVABLE" ? "Income (receivables)" : "Money already in accounts"}</SelectLabel>
                  {list.map((o) => <SelectItem key={o.key} value={o.key}>{o.label} <span className="text-muted-foreground">· {o.detail}</span></SelectItem>)}
                </SelectGroup>
              );
            })}
          </SelectContent>
        </Select>
      </div>
      {opt && (
        <div className="space-y-1.5">
          <Label htmlFor="src-amt">How much of it this month uses</Label>
          <Input id="src-amt" type="number" inputMode="decimal" min="0" step="0.01" required={opt.kind === "ACCOUNT"} value={amount} onChange={(e) => setAmount(e.target.value)} className="tabular-nums" />
          <p className={cn("text-xs", amt > opt.room + 0.005 ? "text-negative" : "text-muted-foreground")}>
            {formatMoney(opt.room, currency)} {opt.kind === "RECEIVABLE" ? "of it isn't budgeted in another month" : "of the balance is free (not set aside elsewhere, and not counted as received income)"}.
          </p>
        </div>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={busy || !opt || !(amt > 0) || amt > (opt?.room ?? 0) + 0.005}>{busy ? "Adding…" : "Add"}</Button>
      </DialogFooter>
    </form>
  );
}

function EditSource({ source, currency, room, onDone, onCancel }: { source: Source; currency: string; room: number | null; onDone: () => void; onCancel: () => void }) {
  const [amount, setAmount] = useState(String(source.amount));
  const [busy, setBusy] = useState(false);
  const amt = Number(amount);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/api/budget/sources/${source.id}`, { method: "PATCH", body: { amount: amt } });
      toast.success(`${source.label} now counts ${formatMoney(amt, currency)}.`);
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{source.label}</DialogTitle>
        <DialogDescription>How much of it this month&apos;s budget counts on.</DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        <Label htmlFor="src-edit">Amount</Label>
        <Input id="src-edit" autoFocus type="number" inputMode="decimal" min="0.01" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} className="tabular-nums" />
        <p className="text-xs text-muted-foreground">
          At least {formatMoney(source.allocated, currency)} (what its lines use){room != null ? `, at most ${formatMoney(room, currency)}` : ""}.
        </p>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={busy || !(amt > 0)}>{busy ? "Saving…" : "Save"}</Button>
      </DialogFooter>
    </form>
  );
}
