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
import { newKey } from "@/lib/client";
import { ChevronDown } from "lucide-react";
import { useInvestmentCash } from "@/components/investments/InvestmentCash";

interface UnitsTarget {
  holdingId: string;
  name: string;
  currency: string;
  /** Latest price or NAV, to prefill. */
  price: number | null;
  lots: { id: string; quantity: number; price: number; purchaseDate: string }[];
  /** Only these purchases can be sold (a row filtered to one client's). */
  onlyLots?: { label: string };
  /** Purchases grouped by their own categories (clients), to sell from one. */
  groups?: { id: string; label: string; lotIds: string[] }[];
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

type Proceeds = "INVESTMENT_CASH" | "ACCOUNT" | "TRACKING";
/** The three ways a sale's money can go, in the order offered. */
const PROCEEDS: { value: Proceeds; label: string; hint: string }[] = [
  { value: "INVESTMENT_CASH", label: "Keep for reinvestment", hint: "Net proceeds go to investment cash, ready for your next purchase or to withdraw later." },
  { value: "ACCOUNT", label: "Transfer to bank", hint: "Net proceeds are credited to the account you pick." },
  { value: "TRACKING", label: "Tracking only", hint: "Updates your portfolio and profit only. No money is added anywhere in VAULT." },
];

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
  // Default: real proceeds kept for reinvestment. Never remembered, so a
  // tracking-only choice can't silently carry over to a real sale.
  const [proceeds, setProceeds] = useState<Proceeds>("INVESTMENT_CASH");
  const cash = useInvestmentCash();
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

  // Your last choice for this currency, else the deposit's linked account,
  // else one in the holding's currency, else the first.
  const suggested = useMemo(() => {
    let remembered: string | null = null;
    try {
      remembered = localStorage.getItem(`vault.sell.account.${target.currency}`);
    } catch {}
    const linked = target.kind === "FIXED_DEPOSIT" ? accounts.find((a) => a.id === target.linkedAccountId) : undefined;
    return (accounts.find((a) => a.id === remembered) ?? linked ?? accounts.find((a) => a.currency === target.currency) ?? accounts[0])?.id ?? "";
  }, [accounts, target]);
  // Which purchases to sell from: all of them, or one group's (oldest first either way).
  const [fromGroup, setFromGroup] = useState("");
  const [more, setMore] = useState(false);
  // One per form: a double submit or a retry records the sale once.
  const [idempotencyKey] = useState(() => newKey());
  const units = target.kind === "STOCK" || target.kind === "MUTUAL_FUND" ? target : null;
  const group = units?.groups?.find((g) => g.id === fromGroup) ?? null;
  const sellLots = useMemo(() => (units ? (group ? units.lots.filter((l) => group.lotIds.includes(l.id)) : units.lots) : []), [units, group]);
  const restricted = !!(units?.onlyLots || group);
  const accountId = picked || suggested;
  const account = accounts.find((a) => a.id === accountId);
  const toAccount = proceeds === "ACCOUNT";
  const crossCurrency = toAccount && !!(account && account.currency !== target.currency);

  const preview = useMemo(() => {
    if (!soldOn) return null;
    const fee = Number(charges) || 0;
    if (target.kind === "STOCK" || target.kind === "MUTUAL_FUND") {
      const qty = Number(quantity), px = Number(price);
      const owned = r6(sellLots.reduce((s, l) => s + l.quantity, 0));
      if (!(qty > 0) || !(px >= 0) || price === "") return { owned };
      try {
        const { used } = matchLotsFifo(sellLots.map((l) => ({ ...l, purchaseDate: new Date(l.purchaseDate) })), qty, new Date(soldOn));
        const gross = roundMoney(qty * px);
        const cost = roundMoney(used.reduce((s, l) => s + l.cost, 0));
        // A row filtered to one client lists only their purchases; the stock
        // closes only when nothing at all is left.
        const all = r6(target.lots.reduce((s, l) => s + l.quantity, 0));
        return { owned, gross, cost, net: roundMoney(gross - fee), used, closes: !units?.onlyLots && qty >= all - 1e-9 };
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
  }, [target, units, sellLots, quantity, price, amount, charges, soldOn]);

  const copy = COPY[target.kind];
  const c = target.currency;
  const pnl = preview && "net" in preview && preview.net != null && preview.cost != null ? roundMoney(preview.net - preview.cost) : null;
  const premature = target.kind === "FIXED_DEPOSIT" && soldOn < target.maturityDate.slice(0, 10);
  const invalid = !!(preview && "error" in preview && preview.error) || !!(preview && "net" in preview && preview.net != null && preview.net <= 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    const body: Record<string, unknown> = {
      kind: target.kind,
      holdingId: target.holdingId,
      charges: charges || 0,
      soldOn,
      proceeds,
      ...(toAccount ? { accountId } : {}),
      idempotencyKey,
      note: note || undefined,
      ...(crossCurrency ? { creditedAmount: credited } : {}),
      ...(target.kind === "STOCK" || target.kind === "MUTUAL_FUND" ? { quantity, price } : { amount }),
      ...(target.kind === "STOCK" && restricted ? { lotIds: sellLots.map((l) => l.id) } : {}),
    };
    const res = await fetch("/api/investments/sales", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      toast.error(data.error || "Couldn't record the sale.");
      return;
    }
    if (toAccount) {
      try {
        localStorage.setItem(`vault.sell.account.${target.currency}`, accountId);
      } catch {}
    }
    const net = Number(data.sale?.netProceeds ?? 0);
    toast.success(
      data.duplicate
        ? "Already recorded: this sale was saved once."
        : toAccount
          ? `${formatMoney(Number(data.sale?.creditedAmount ?? 0), account?.currency ?? c)} credited to ${account?.name ?? "the account"}.`
          : proceeds === "INVESTMENT_CASH"
            ? `${formatMoney(net, c)} added to investment cash.`
            : "Sale recorded for tracking. No money moved."
    );
    onClose();
    onSold();
    cash?.reload();
  }

  const lastPrice = units?.price;
  return (
    <>
        <DialogHeader>
          <DialogTitle>{copy.title} {target.name}</DialogTitle>
          <DialogDescription>
            {units
              ? `${preview?.owned ?? 0} ${copy.unit.toLowerCase()} available${units.onlyLots ? ` in ${units.onlyLots.label}` : group ? ` in ${group.label}` : ""}${lastPrice != null ? ` · last ${formatMoney(lastPrice, c)}` : ""}`
              : target.kind === "FIXED_DEPOSIT"
                ? `${formatMoney(target.principal, c)} at ${target.rate}% · matures ${formatDate(target.maturityDate)}`
                : target.kind === "OTHER"
                  ? `Bought for ${formatMoney(target.cost, c)} · valued ${formatMoney(target.value, c)}`
                  : ""}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          {units ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="sell-qty">{copy.unit}</Label>
                  <button type="button" className="cursor-pointer text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={() => setQuantity(String(preview?.owned ?? ""))}>
                    All
                  </button>
                </div>
                <Input id="sell-qty" type="number" step="any" min="0" max={preview?.owned ?? undefined} value={quantity} onChange={(e) => setQuantity(e.target.value)} required aria-invalid={!!(preview && "error" in preview && preview.error)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sell-price">{target.kind === "MUTUAL_FUND" ? "NAV" : "Price per share"}</Label>
                <Input id="sell-price" type="number" step="any" min="0" value={price} onChange={(e) => setPrice(e.target.value)} required />
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="sell-amount">{target.kind === "FIXED_DEPOSIT" ? "Amount paid out" : "Sale price"}</Label>
              <Input id="sell-amount" type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} required />
              {target.kind === "FIXED_DEPOSIT" && <p className="text-xs text-muted-foreground">Suggested from interest to the closing date. Use what the bank paid.</p>}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sell-date">{target.kind === "FIXED_DEPOSIT" ? "Closed on" : "Date"}</Label>
              <Input id="sell-date" type="date" value={soldOn} max={today} onChange={(e) => changeDate(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sell-charges" title={copy.chargesHint}>{target.kind === "FIXED_DEPOSIT" ? "Deductions" : "Charges"}</Label>
              <Input id="sell-charges" type="number" step="0.01" min="0" value={charges} onChange={(e) => setCharges(e.target.value)} placeholder="0" aria-describedby="sell-charges-hint" />
              <span id="sell-charges-hint" className="sr-only">{copy.chargesHint}</span>
            </div>
          </div>
          {premature && <p className="text-xs text-muted-foreground">Before maturity: recorded as an early closure. Put any penalty under deductions.</p>}

          <fieldset className="space-y-2">
            <legend className="mb-1.5 text-sm font-medium">What happens to the money</legend>
            <div role="radiogroup" aria-label="What happens to the money" className="grid grid-cols-3 gap-0.5 rounded-lg bg-muted p-0.5 text-xs">
              {PROCEEDS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={proceeds === o.value}
                  onClick={() => setProceeds(o.value)}
                  className={cn("min-h-8 cursor-pointer rounded-md px-1.5 py-1 leading-tight transition-colors", proceeds === o.value ? "bg-card font-medium shadow-card" : "text-muted-foreground hover:text-foreground")}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{PROCEEDS.find((o) => o.value === proceeds)!.hint}</p>
            {toAccount && (
              <>
                <Select value={accountId} onValueChange={(v) => v && setPicked(v)}>
                  <SelectTrigger className="w-full" aria-label="Account"><SelectValue placeholder={accounts.length ? "Choose account" : "Add an account first"} /></SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name} <span className="text-muted-foreground">· {formatMoney(a.currentBalance, a.currency)}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {crossCurrency && account && (
                  <Input id="sell-credited" type="number" step="0.01" min="0" value={credited} onChange={(e) => setCredited(e.target.value)} required placeholder={`Amount that arrived in ${account.currency}`} aria-label={`Amount that arrived in ${account.currency}`} />
                )}
              </>
            )}
          </fieldset>

          {preview && "error" in preview && preview.error && <p className="text-sm text-negative">{preview.error}</p>}
          {preview && "net" in preview && preview.net != null && (
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-lg bg-muted/50 px-3 py-2.5 text-sm">
              <dt className="text-muted-foreground">Gross</dt>
              <dd className="text-right tabular-nums">{formatMoney(preview.gross!, c)}</dd>
              {Number(charges) > 0 && (<><dt className="text-muted-foreground">{target.kind === "FIXED_DEPOSIT" ? "Deductions" : "Charges"}</dt><dd className="text-right tabular-nums">−{formatMoney(Number(charges), c)}</dd></>)}
              <dt className="font-medium">{toAccount ? `Net to ${account?.name ?? "account"}` : proceeds === "INVESTMENT_CASH" ? "Net to investment cash" : "Net proceeds, not added anywhere"}</dt>
              <dd className="text-right font-semibold tabular-nums">{formatMoney(preview.net, c)}</dd>
              {proceeds === "INVESTMENT_CASH" && cash && (
                <>
                  <dt className="text-xs text-muted-foreground">Investment cash afterwards</dt>
                  <dd className="text-right text-xs tabular-nums text-muted-foreground">{formatMoney(roundMoney(cash.balanceOf(c) + preview.net), c)}</dd>
                </>
              )}
              <dt className="text-xs text-muted-foreground">{target.kind === "FIXED_DEPOSIT" ? "Interest earned" : "Profit / loss"} on cost {formatMoney(preview.cost!, c)}</dt>
              <dd className={cn("text-right text-xs tabular-nums", pnl! > 0 ? "text-positive" : pnl! < 0 ? "text-negative" : "text-muted-foreground")}>
                {signed(pnl!, c)}{preview.cost! > 0 && ` (${((pnl! / preview.cost!) * 100).toFixed(1)}%)`}
              </dd>
              {preview.closes && <dd className="col-span-2 text-xs text-muted-foreground">Nothing is left afterwards; it moves to Sold &amp; closed.</dd>}
            </dl>
          )}

          <div>
            <button type="button" onClick={() => setMore(!more)} aria-expanded={more} className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", more && "rotate-180")} />
              More options
            </button>
            {more && (
              <div className="mt-3 space-y-3">
                {units?.groups && units.groups.length > 0 && !units.onlyLots && (
                  <div className="space-y-1.5">
                    <Label>Sell from</Label>
                    <Select value={fromGroup || "__all__"} onValueChange={(v) => setFromGroup(v === "__all__" ? "" : v)}>
                      <SelectTrigger className="w-full" aria-label="Sell from"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">Any purchase, oldest first</SelectItem>
                        {units.groups.map((g) => {
                          const qty = r6(units.lots.filter((l) => g.lotIds.includes(l.id)).reduce((t, l) => t + l.quantity, 0));
                          return <SelectItem key={g.id} value={g.id}>{g.label} · {qty} {copy.unit.toLowerCase()}</SelectItem>;
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="sell-note">Note</Label>
                  <Input id="sell-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Like a contract note number" />
                </div>
                {preview && "used" in preview && preview.used && preview.used.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {preview.used.length === 1 ? `Held for ${heldFor(preview.used[0].purchaseDate, soldOn)}.` : `Uses ${preview.used.length} purchases, oldest first.`}
                  </p>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving || (toAccount && !accountId) || invalid}>
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
