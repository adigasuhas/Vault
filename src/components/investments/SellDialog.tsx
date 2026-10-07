"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { formatMoney } from "@/lib/currencies";
import { formatDate } from "@/lib/format";
import { isoDate } from "@/lib/dates";
import { fdCurrentValue } from "@/lib/investments";
import { matchLotsFifo, heldFor, r6, type SoldLot } from "@/lib/fifo";
import { roundMoney } from "@/lib/validate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Equivalent } from "@/components/app/Money";

interface UnitsTarget {
  holdingId: string;
  name: string;
  currency: string;
  /** Latest price or NAV, to prefill. */
  price: number | null;
  lots: { id: string; quantity: number; price: number; purchaseDate: string }[];
}

export type SellTarget =
  | (UnitsTarget & { kind: "STOCK" })
  | (UnitsTarget & { kind: "MUTUAL_FUND" })
  | {
      kind: "FIXED_DEPOSIT";
      holdingId: string;
      name: string;
      currency: string;
      principal: number;
      rate: number;
      startDate: string;
      maturityDate: string;
      linkedAccountId: string | null;
    }
  | { kind: "OTHER"; holdingId: string; name: string; currency: string; cost: number; value: number; purchaseDate: string };

interface Account { id: string; name: string; currency: string; status: string; currentBalance: string }

const COPY = {
  STOCK: { title: "Sell", unit: "Shares", price: "Sale price per share", charges: "Charges", chargesHint: "Brokerage, taxes and fees", verb: "Sell" },
  MUTUAL_FUND: { title: "Redeem", unit: "Units", price: "NAV per unit", charges: "Charges", chargesHint: "Exit load, stamp duty or other deductions", verb: "Redeem" },
  FIXED_DEPOSIT: { title: "Close", unit: "", price: "", charges: "Penalty or tax deducted", chargesHint: "Premature-withdrawal penalty, TDS", verb: "Close deposit" },
  OTHER: { title: "Sell", unit: "", price: "", charges: "Charges", chargesHint: "Making charges, commission, fees", verb: "Sell" },
} as const;

const signed = (n: number, c: string) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${formatMoney(Math.abs(n), c)}`;

/** Opens the sell dialog from any holdings table under the provider. */
export const SellContext = createContext<((t: SellTarget) => void) | null>(null);
export const useSell = () => useContext(SellContext);

export function SellDialog({ target, onOpenChange, onSold }: { target: SellTarget | null; onOpenChange: (open: boolean) => void; onSold: () => void }) {
  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        {target && <SellForm key={`${target.kind}:${target.holdingId}`} target={target} onClose={() => onOpenChange(false)} onSold={onSold} />}
      </DialogContent>
    </Dialog>
  );
}

function SellForm({ target, onClose, onSold }: { target: SellTarget; onClose: () => void; onSold: () => void }) {
  const today = isoDate(new Date());
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState(() => (target.kind === "STOCK" || target.kind === "MUTUAL_FUND") && target.price != null ? String(r6(target.price)) : "");
  const [amount, setAmount] = useState(() => (target.kind === "FIXED_DEPOSIT" ? String(depositValue(target, today)) : target.kind === "OTHER" ? String(target.value) : ""));
  const [charges, setCharges] = useState("");
  const [soldOn, setSoldOn] = useState(today);
  const [picked, setPicked] = useState("");
  const [credited, setCredited] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/accounts")
      .then((r) => r.json())
      .then((d) => {
        if (!live) return;
        const open: Account[] = (d.accounts ?? []).filter((a: Account) => a.status !== "CLOSED");
        setAccounts(open);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [target]);

  // A deposit's suggested payout follows the closing date.
  function changeDate(v: string) {
    setSoldOn(v);
    if (target.kind === "FIXED_DEPOSIT" && v) setAmount(String(depositValue(target, v)));
  }

  // The deposit's linked account, else one in the holding's currency, else the first.
  const suggested = useMemo(() => {
    const linked = target.kind === "FIXED_DEPOSIT" ? accounts.find((a) => a.id === target.linkedAccountId) : undefined;
    return (linked ?? accounts.find((a) => a.currency === target.currency) ?? accounts[0])?.id ?? "";
  }, [accounts, target]);
  const accountId = picked || suggested;
  const account = accounts.find((a) => a.id === accountId);
  const crossCurrency = !!(account && account.currency !== target.currency);

  const preview = useMemo(() => {
    if (!soldOn) return null;
    const fee = Number(charges) || 0;
    if (target.kind === "STOCK" || target.kind === "MUTUAL_FUND") {
      const qty = Number(quantity), px = Number(price);
      const owned = r6(target.lots.reduce((s, l) => s + l.quantity, 0));
      if (!(qty > 0) || !(px >= 0) || price === "") return { owned };
      try {
        const { used } = matchLotsFifo(target.lots.map((l) => ({ ...l, purchaseDate: new Date(l.purchaseDate) })), qty, new Date(soldOn));
        const gross = roundMoney(qty * px);
        const cost = roundMoney(used.reduce((s, l) => s + l.cost, 0));
        return { owned, gross, cost, net: roundMoney(gross - fee), used, closes: qty >= owned - 1e-9 };
      } catch (e) {
        return { owned, error: (e as Error).message };
      }
    }
    const gross = Number(amount);
    if (!(gross > 0)) return {};
    const cost = target.kind === "FIXED_DEPOSIT" ? target.principal : target.cost;
    const since = target.kind === "FIXED_DEPOSIT" ? target.startDate : target.purchaseDate;
    const used: SoldLot[] = [{ lotId: null, purchaseDate: since, quantity: null, price: null, cost }];
    return { gross, cost, net: roundMoney(gross - fee), used, closes: true };
  }, [target, quantity, price, amount, charges, soldOn]);

  const copy = COPY[target.kind];
  const c = target.currency;
  const pnl = preview && "net" in preview && preview.net != null && preview.cost != null ? roundMoney(preview.net - preview.cost) : null;
  const premature = target.kind === "FIXED_DEPOSIT" && soldOn < target.maturityDate.slice(0, 10);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const body: Record<string, unknown> = {
      kind: target.kind,
      holdingId: target.holdingId,
      charges: charges || 0,
      soldOn,
      accountId,
      note: note || undefined,
      ...(crossCurrency ? { creditedAmount: credited } : {}),
      ...(target.kind === "STOCK" || target.kind === "MUTUAL_FUND" ? { quantity, price } : { amount }),
    };
    const res = await fetch("/api/investments/sales", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      toast.error(data.error || "Couldn't record the sale.");
      return;
    }
    toast.success(`${account ? `Credited to ${account.name}. ` : ""}It's under Sold & closed.`);
    onClose();
    onSold();
  }

  return (
    <>
        <DialogHeader>
          <DialogTitle>{copy.title} {target.name}</DialogTitle>
          <DialogDescription>
            {target.kind === "STOCK" || target.kind === "MUTUAL_FUND"
              ? `The oldest purchases are sold first. You hold ${preview?.owned ?? 0} ${copy.unit.toLowerCase()}.`
              : target.kind === "FIXED_DEPOSIT"
                ? `${formatMoney(target.principal, c)} at ${target.rate}% a year, maturing ${formatDate(target.maturityDate)}.`
                : `Bought for ${formatMoney(target.cost, c)} on ${formatDate(target.purchaseDate)}.`}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          {(target.kind === "STOCK" || target.kind === "MUTUAL_FUND") && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="sell-qty">{copy.unit}</Label>
                  <button type="button" className="cursor-pointer text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={() => setQuantity(String(preview?.owned ?? ""))}>
                    All
                  </button>
                </div>
                <Input id="sell-qty" type="number" step="any" min="0" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sell-price">{copy.price}</Label>
                <Input id="sell-price" type="number" step="any" min="0" value={price} onChange={(e) => setPrice(e.target.value)} required />
              </div>
            </div>
          )}
          {(target.kind === "FIXED_DEPOSIT" || target.kind === "OTHER") && (
            <div className="space-y-2">
              <Label htmlFor="sell-amount">{target.kind === "FIXED_DEPOSIT" ? "Amount paid out, before deductions" : "Sale price"}</Label>
              <Input id="sell-amount" type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} required />
              <p className="text-xs text-muted-foreground">
                {target.kind === "FIXED_DEPOSIT"
                  ? "Suggested from the interest earned up to the closing date. Use what the bank actually paid."
                  : `Last valued at ${formatMoney(target.value, c)}.`}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="sell-date">{target.kind === "FIXED_DEPOSIT" ? "Closed on" : "Sold on"}</Label>
              <Input id="sell-date" type="date" value={soldOn} max={today} onChange={(e) => changeDate(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sell-charges">{copy.charges} <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Input id="sell-charges" type="number" step="0.01" min="0" value={charges} onChange={(e) => setCharges(e.target.value)} placeholder="0" title={copy.chargesHint} />
            </div>
          </div>
          {premature && <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">This is before the maturity date, so it&apos;s recorded as an early closure. Enter any penalty under deductions.</p>}

          <div className="space-y-2">
            <Label>Credit the money to</Label>
            <Select value={accountId} onValueChange={(v) => v && setPicked(v)}>
              <SelectTrigger className="w-full"><SelectValue placeholder={accounts.length ? "Choose account" : "Add an account first"} /></SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name} <span className="text-muted-foreground">· {formatMoney(a.currentBalance, a.currency)}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {crossCurrency && account && (
            <div className="space-y-2">
              <Label htmlFor="sell-credited">Amount that arrived in {account.currency}</Label>
              <Input id="sell-credited" type="number" step="0.01" min="0" value={credited} onChange={(e) => setCredited(e.target.value)} required />
              <p className="text-xs text-muted-foreground">The sale is in {c}, the account in {account.currency}. Profit and loss stay in {c}.</p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="sell-note">Note <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Input id="sell-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Like Rebalancing, or Contract note number" />
          </div>

          {preview && "error" in preview && preview.error && <p className="text-sm text-negative">{preview.error}</p>}
          {preview && "net" in preview && preview.net != null && (
            <div className="rounded-xl border border-border bg-muted/40 p-3 text-sm">
              <dl className="grid grid-cols-2 gap-y-1.5">
                <dt className="text-muted-foreground">{target.kind === "FIXED_DEPOSIT" ? "Paid out" : "Sale value"}</dt>
                <dd className="text-right tabular-nums">{formatMoney(preview.gross!, c)}</dd>
                {Number(charges) > 0 && (<><dt className="text-muted-foreground">Deductions</dt><dd className="text-right tabular-nums">−{formatMoney(Number(charges), c)}</dd></>)}
                <dt className="text-muted-foreground">You receive</dt>
                <dd className="text-right font-medium tabular-nums">{formatMoney(preview.net, c)}<Equivalent both stack value={preview.net} currency={c} /></dd>
                <dt className="text-muted-foreground">{target.kind === "FIXED_DEPOSIT" ? "Principal" : "Cost of what's sold"}</dt>
                <dd className="text-right tabular-nums">{formatMoney(preview.cost!, c)}<Equivalent both stack value={preview.cost!} currency={c} /></dd>
                <dt className="font-medium">{target.kind === "FIXED_DEPOSIT" ? "Interest earned" : "Profit / loss"}</dt>
                <dd className={cn("text-right font-medium tabular-nums", pnl! > 0 ? "text-positive" : pnl! < 0 ? "text-negative" : "")}>
                  {signed(pnl!, c)}
                  {preview.cost! > 0 && <span className="ml-1 text-xs">({((pnl! / preview.cost!) * 100).toFixed(2)}%)</span>}
                  <Equivalent both stack signed value={pnl!} currency={c} />
                </dd>
              </dl>
              {preview.used && preview.used.length > 0 && (
                <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
                  {preview.used.length === 1
                    ? `Held for ${heldFor(preview.used[0].purchaseDate, soldOn)}.`
                    : `Uses ${preview.used.length} purchases, held between ${heldFor(preview.used[preview.used.length - 1].purchaseDate, soldOn)} and ${heldFor(preview.used[0].purchaseDate, soldOn)}.`}
                  {preview.closes ? " Nothing is left afterwards, so it moves to Sold & closed." : ""}
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving || !accountId || !!(preview && "error" in preview && preview.error)}>
              {saving ? "Saving…" : copy.verb}
            </Button>
          </DialogFooter>
        </form>
    </>
  );
}

function depositValue(t: Extract<SellTarget, { kind: "FIXED_DEPOSIT" }>, on: string) {
  const day = new Date(on);
  const maturity = new Date(t.maturityDate);
  return roundMoney(fdCurrentValue(t.principal, t.rate, t.startDate, day < maturity ? day : maturity));
}
