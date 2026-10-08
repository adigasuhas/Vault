"use client";

import { useEffect, useState } from "react";
import { formatMoney } from "@/lib/currencies";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** How a purchase was paid for: nothing recorded, an account (optionally
 * counted in a budget line), or a sale's kept proceeds. */
export interface FundingValue {
  source: "NONE" | "ACCOUNT" | "SALE";
  accountId: string;
  categoryId: string;
  saleId: string;
  paidAmount: string;
}
export const emptyFunding = (): FundingValue => ({ source: "NONE", accountId: "", categoryId: "", saleId: "", paidAmount: "" });

/** The request fields for a funding choice (see lib/investment-funding). */
export function fundingBody(f: FundingValue) {
  if (f.source === "ACCOUNT" && f.accountId) {
    return {
      paidFromAccountId: f.accountId,
      ...(f.categoryId ? { budgetCategoryId: f.categoryId } : {}),
      ...(Number(f.paidAmount) > 0 ? { paidAmount: Number(f.paidAmount) } : {}),
    };
  }
  if (f.source === "SALE" && f.saleId) return { fromSaleId: f.saleId };
  return {};
}

interface Account { id: string; name: string; currency: string; status: string; currentBalance: string }
interface Category { id: string; name: string }
interface Sale { id: string; name: string; currency: string; proceedsLeft: number; reversedAt: string | null; account: unknown }

/** "Paid from" for an investment purchase. Paying from an account takes the
 * money out of it; with a budget category it also counts in that month's
 * budget. Paying from a sale's kept proceeds records a reinvestment. */
export function FundingFields({ value, onChange, currency, cost }: { value: FundingValue; onChange: (v: FundingValue) => void; currency: string; cost: number }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  useEffect(() => {
    Promise.all([fetch("/api/accounts").then((r) => r.json()), fetch("/api/categories").then((r) => r.json()), fetch("/api/investments/sales").then((r) => r.json())])
      .then(([a, c, s]) => {
        setAccounts((a.accounts ?? []).filter((x: Account) => x.status !== "CLOSED"));
        setCategories((c.categories ?? []).filter((x: Category) => !x.name.startsWith("Loan: ")));
        setSales((s.sales ?? []).filter((x: Sale) => !x.reversedAt && !x.account && x.proceedsLeft > 0.004));
      })
      .catch(() => {});
  }, []);
  const account = accounts.find((a) => a.id === value.accountId);
  const cross = !!(account && account.currency !== currency);
  const usableSales = sales.filter((s) => s.currency === currency);
  const sale = usableSales.find((s) => s.id === value.saleId);
  const set = (patch: Partial<FundingValue>) => onChange({ ...value, ...patch });
  const pickSource = (source: FundingValue["source"]) => {
    if (source === "ACCOUNT") {
      const first = accounts.find((a) => a.currency === currency) ?? accounts[0];
      const savings = categories.find((c) => /invest|saving/i.test(c.name));
      onChange({ ...value, source, accountId: value.accountId || first?.id || "", categoryId: value.categoryId || savings?.id || "" });
    } else if (source === "SALE") {
      onChange({ ...value, source, saleId: value.saleId || usableSales[0]?.id || "" });
    } else onChange({ ...value, source });
  };

  const options: [FundingValue["source"], string][] = [
    ["NONE", "Just track it"],
    ["ACCOUNT", "From an account"],
    ...(usableSales.length ? ([["SALE", "Sale proceeds"]] as [FundingValue["source"], string][]) : []),
  ];

  return (
    <div className="space-y-2.5 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label>Paid from</Label>
        <div role="radiogroup" aria-label="Paid from" className="inline-flex rounded-md bg-muted p-0.5 text-xs">
          {options.map(([v, l]) => (
            <button key={v} type="button" role="radio" aria-checked={value.source === v} onClick={() => pickSource(v)} className={cn("h-7 cursor-pointer rounded px-2.5 transition-colors", value.source === v ? "bg-card font-medium shadow-card" : "text-muted-foreground hover:text-foreground")}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {value.source === "NONE" && <p className="text-xs text-muted-foreground">Recorded as a holding only. No account or budget changes.</p>}
      {value.source === "ACCOUNT" && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Select value={value.accountId} onValueChange={(v) => set({ accountId: v })}>
            <SelectTrigger className="w-full" aria-label="Account"><SelectValue placeholder="Choose account" /></SelectTrigger>
            <SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name} · {formatMoney(a.currentBalance, a.currency)}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={value.categoryId || "__none__"} onValueChange={(v) => set({ categoryId: v === "__none__" ? "" : v })}>
            <SelectTrigger className="w-full" aria-label="Budget line"><SelectValue placeholder="Budget line" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Not in the budget</SelectItem>
              <SelectSeparator />
              {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {cross && account && (
            <Input type="number" step="0.01" min="0" value={value.paidAmount} onChange={(e) => set({ paidAmount: e.target.value })} placeholder={`Amount that left it, in ${account.currency}`} aria-label={`Amount in ${account.currency}`} className="sm:col-span-2" />
          )}
          <p className="text-xs text-muted-foreground sm:col-span-2">
            {cost > 0 ? `${formatMoney(cost, currency)} ` : ""}comes out of the account{value.categoryId ? ` and counts toward ${categories.find((c) => c.id === value.categoryId)?.name ?? "the budget line"} that month` : ""}. It isn&apos;t counted as spending in analytics: the money moved into your investments.
          </p>
        </div>
      )}
      {value.source === "SALE" && (
        <div className="space-y-2">
          <Select value={value.saleId} onValueChange={(v) => set({ saleId: v })}>
            <SelectTrigger className="w-full" aria-label="Sale"><SelectValue placeholder="Choose a sale" /></SelectTrigger>
            <SelectContent>{usableSales.map((s) => <SelectItem key={s.id} value={s.id}>{s.name} · {formatMoney(s.proceedsLeft, s.currency)} left</SelectItem>)}</SelectContent>
          </Select>
          {sale && cost > sale.proceedsLeft + 0.004 && <p className="text-xs text-negative">Only {formatMoney(sale.proceedsLeft, sale.currency)} of that sale is left to reinvest.</p>}
          <p className="text-xs text-muted-foreground">Recorded as reinvesting that sale&apos;s proceeds. No account changes.</p>
        </div>
      )}
    </div>
  );
}
