"use client";

import { useEffect, useState } from "react";
import { formatMoney } from "@/lib/currencies";
import { roundMoney } from "@/lib/validate";
import { useInvestmentCash } from "@/components/investments/InvestmentCash";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * How a purchase is paid for: nothing recorded ("just track it"), investment
 * cash, an account, or investment cash with an account covering the rest.
 * `cash` is the investment cash amount; left empty it means "as much as
 * covers the total" (up to what's available).
 */
export interface FundingValue {
  source: "NONE" | "CASH" | "ACCOUNT";
  cash: string;
  accountId: string;
  categoryId: string;
  paidAmount: string;
}
export const emptyFunding = (): FundingValue => ({ source: "NONE", cash: "", accountId: "", categoryId: "", paidAmount: "" });

/** The investment cash used and the part an account covers. */
export function fundingSplit(f: FundingValue, total: number, available: number) {
  const t = roundMoney(Math.max(0, total));
  if (f.source !== "CASH") return { cash: 0, rest: f.source === "ACCOUNT" ? t : 0 };
  const cash = roundMoney(f.cash.trim() === "" ? Math.min(available, t) : Math.max(0, Number(f.cash) || 0));
  return { cash, rest: roundMoney(Math.max(0, t - cash)) };
}

/** Why the funding can't be submitted yet, or null. */
export function fundingProblem(f: FundingValue, total: number, available: number, currency: string) {
  if (f.source === "NONE" || !(total > 0)) return null;
  if (f.source === "ACCOUNT") return f.accountId ? null : "Choose the account it was paid from.";
  const { cash, rest } = fundingSplit(f, total, available);
  if (cash > available + 0.004) return `Investment cash has ${formatMoney(available, currency)}.`;
  if (cash > total + 0.004) return `That's more than the ${formatMoney(total, currency)} it costs.`;
  if (rest > 0.004 && !f.accountId) return `Choose an account for the other ${formatMoney(rest, currency)}.`;
  return null;
}

/** The request fields for a funding choice (see lib/investment-funding). */
export function fundingBody(f: FundingValue, total: number, available: number) {
  const account = f.accountId
    ? { paidFromAccountId: f.accountId, ...(f.categoryId ? { budgetCategoryId: f.categoryId } : {}), ...(Number(f.paidAmount) > 0 ? { paidAmount: Number(f.paidAmount) } : {}) }
    : {};
  if (f.source === "ACCOUNT") return account;
  if (f.source === "CASH") {
    const { cash, rest } = fundingSplit(f, total, available);
    return { ...(cash > 0 ? { fromCash: cash } : {}), ...(rest > 0.004 ? account : {}) };
  }
  return {};
}

interface Account { id: string; name: string; currency: string; status: string; currentBalance: string }
interface Category { id: string; name: string }

/** "Paid from" for an investment purchase. Investment cash shows what's
 * available; when it doesn't cover the total, an account covers the rest
 * (chosen by the user, never automatically). `total` includes charges. */
export function FundingFields({ value, onChange, currency, total }: { value: FundingValue; onChange: (v: FundingValue) => void; currency: string; total: number }) {
  const cashCtx = useInvestmentCash();
  const available = cashCtx?.balanceOf(currency) ?? 0;
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  useEffect(() => {
    Promise.all([fetch("/api/accounts").then((r) => r.json()), fetch("/api/categories").then((r) => r.json())])
      .then(([a, c]) => {
        setAccounts((a.accounts ?? []).filter((x: Account) => x.status !== "CLOSED"));
        setCategories((c.categories ?? []).filter((x: Category) => !x.name.startsWith("Loan: ")));
      })
      .catch(() => {});
  }, []);
  const set = (patch: Partial<FundingValue>) => onChange({ ...value, ...patch });
  const account = accounts.find((a) => a.id === value.accountId);
  const cross = !!(account && account.currency !== currency);
  const { cash, rest } = fundingSplit(value, total, available);
  const usesAccount = value.source === "ACCOUNT" || (value.source === "CASH" && rest > 0.004);
  const problem = fundingProblem(value, total, available, currency);
  const savings = () => value.categoryId || categories.find((c) => /invest|saving/i.test(c.name))?.id || "";

  const choice = value.source === "ACCOUNT" ? `A:${value.accountId}` : value.source;
  const pick = (v: string) => {
    if (v === "NONE") return onChange({ ...value, source: "NONE" });
    if (v === "CASH") return onChange({ ...value, source: "CASH", cash: "" });
    onChange({ ...value, source: "ACCOUNT", accountId: v.slice(2), categoryId: savings() });
  };

  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        <Label>Paid from</Label>
        <Select value={choice} onValueChange={pick}>
          <SelectTrigger className="w-full" aria-label="Paid from"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="NONE">Just track it</SelectItem>
            <SelectItem value="CASH">Investment cash · {formatMoney(available, currency)} available</SelectItem>
            {accounts.length > 0 && <SelectSeparator />}
            {accounts.map((a) => <SelectItem key={a.id} value={`A:${a.id}`}>{a.name} · {formatMoney(a.currentBalance, a.currency)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {value.source === "CASH" && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="fund-cash">From investment cash</Label>
                {cashCtx && (
                  <button type="button" className="cursor-pointer text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={() => cashCtx.openMove({ direction: "IN", currency, amount: rest > 0 ? rest : undefined })}>
                    Add money
                  </button>
                )}
              </div>
              <Input id="fund-cash" type="number" inputMode="decimal" step="0.01" min="0" value={value.cash} placeholder={String(roundMoney(Math.min(available, Math.max(0, total))))} onChange={(e) => set({ cash: e.target.value })} aria-invalid={cash > available + 0.004} />
            </div>
            {rest > 0.004 && (
              <div className="space-y-1.5">
                <Label>The other {formatMoney(rest, currency)} from</Label>
                <Select value={value.accountId || undefined} onValueChange={(id) => set({ accountId: id, categoryId: savings() })}>
                  <SelectTrigger className="w-full" aria-label="Rest paid from"><SelectValue placeholder="Choose account" /></SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name} · {formatMoney(a.currentBalance, a.currency)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground tabular-nums">
            {formatMoney(available, currency)} available · {formatMoney(Math.max(0, roundMoney(available - cash)), currency)} left after this
          </p>
        </div>
      )}

      {usesAccount && account && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Budget line</Label>
            <Select value={value.categoryId || "__none__"} onValueChange={(v) => set({ categoryId: v === "__none__" ? "" : v })}>
              <SelectTrigger className="w-full" aria-label="Budget line"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Not in the budget</SelectItem>
                <SelectSeparator />
                {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {cross && (
            <div className="space-y-1.5">
              <Label htmlFor="fund-paid">Left {account.name}, in {account.currency}</Label>
              <Input id="fund-paid" type="number" inputMode="decimal" step="0.01" min="0" value={value.paidAmount} onChange={(e) => set({ paidAmount: e.target.value })} required />
            </div>
          )}
        </div>
      )}

      {value.source === "ACCOUNT" && available > 0.004 && (
        <button type="button" onClick={() => onChange({ ...value, source: "CASH", cash: "" })} className="cursor-pointer text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
          Use your {formatMoney(available, currency)} of investment cash first
        </button>
      )}

      {problem ? (
        <p className="text-xs text-negative">{problem}</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {value.source === "NONE"
            ? "Recorded as a holding only; no money moves."
            : value.source === "ACCOUNT"
              ? `${total > 0 ? `${formatMoney(total, currency)} ` : ""}comes out of ${account?.name ?? "the account"}. Not counted as spending.`
              : rest > 0.004
                ? `${formatMoney(cash, currency)} from investment cash and ${formatMoney(rest, currency)} from ${account?.name ?? "the account"}.`
                : `${formatMoney(cash, currency)} comes out of investment cash. No account changes.`}
        </p>
      )}
    </div>
  );
}
