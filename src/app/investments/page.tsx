"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { type SparkPoint } from "@/components/app/Sparkline";
import { PageHeader, Panel, Stat } from "@/components/app/PageHeader";
import { Equivalent } from "@/components/app/Money";
import { useCurrency } from "@/context/CurrencyContext";
import { StockTable, FundTable, StockBreakdown, DepositTable, AssetTable } from "@/components/investments/Holdings";
import { SellContext, SellDialog, type SellTarget } from "@/components/investments/SellDialog";
import { SalesHistory, type SaleRow } from "@/components/investments/SalesHistory";
import { FundingFields, emptyFunding, fundingBody, type FundingValue } from "@/components/investments/FundingFields";
import { CategoryBar, CategoryField, CategoryManager, CategoryPerformance, CategoryProvider, Dot, UNCATEGORISED, assignCategories, emptyPicker, useCategories, type PickerValue } from "@/components/investments/Categories";
import { categoryRows, linkKey, type InvestmentKind, type Position } from "@/lib/category-metrics";
import { useSession } from "@/context/SessionContext";
import { formatMoney } from "@/lib/currencies";
import { SUPPORTED_CURRENCIES } from "@/lib/currencies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { fdCurrentValue } from "@/lib/investments";

interface StockPurchaseLot {
  id: string;
  quantity: string;
  price: string;
  purchaseDate: string;
}

interface StockHolding {
  id: string;
  ticker: string;
  exchange: string | null;
  quantity: string;
  avgBuyPrice: string;
  currency: string;
  purchaseDate: string;
  lastPrice: string | null;
  lastPriceAt: string | null;
  previousClose: string | null;
  lots: StockPurchaseLot[];
}

interface MutualFundHolding {
  id: string;
  fundName: string;
  schemeCode: string | null;
  units: string;
  avgNav: string;
  currency: string;
  purchaseDate: string;
  lastNav: string | null;
  lots?: { id: string; units: string; nav: string; purchaseDate: string }[];
}

interface FixedDeposit {
  id: string;
  linkedAccountId: string | null;
  bank: string;
  principal: string;
  interestRate: string;
  startDate: string;
  maturityDate: string;
  currency: string;
}

interface OtherAsset {
  id: string;
  assetType: string;
  name: string;
  quantity: string | null;
  unit: string | null;
  purchasePrice: string;
  currentValue: string;
  currency: string;
  purchaseDate: string;
  updatedAt?: string;
}

const OTHER_ASSET_TYPES = [
  { value: "GOLD", label: "Gold" },
  { value: "BOND", label: "Bond" },
  { value: "CRYPTO", label: "Cryptocurrency" },
  { value: "REAL_ESTATE", label: "Property" },
  { value: "OTHER", label: "Other" },
];

function gainClass(gain: number) {
  return gain >= 0 ? "text-positive" : "text-negative";
}

interface StockSuggestion {
  symbol: string;
  name: string;
  exchange: string;
}

// Yahoo Finance's internal short exchange codes — matches STOCK_EXCHANGES in
// src/lib/market-data.ts (kept separate so the server-only yahoo-finance2
// client in that module never gets pulled into the client bundle).
// "ALL" is a UI-only sentinel (Radix Select rejects an empty item value) and
// is translated back to "no filter" before hitting the search API.
/** 1-year price series per holding id for the sparkline column, fetched once
 * per page view and shared by the stock and fund tables. Loaded separately so
 * a slow price provider never delays the holdings themselves. */
let seriesPromise: Promise<Record<string, SparkPoint[]>> | null = null;
function usePriceSeries() {
  const [series, setSeries] = useState<Record<string, SparkPoint[]> | null>(null);
  useEffect(() => {
    seriesPromise ??= fetch("/api/investments/history")
      .then((r) => (r.ok ? r.json() : { series: {} }))
      .then((d) => d.series ?? {})
      .catch(() => ({}));
    let alive = true;
    seriesPromise.then((s) => alive && setSeries(s));
    return () => {
      alive = false;
      seriesPromise = null;
    };
  }, []);
  return series;
}

const ALL_EXCHANGES = "ALL";
const EXCHANGE_FILTERS = [
  { code: ALL_EXCHANGES, label: "All exchanges" },
  { code: "NSI", label: "NSE (India)" },
  { code: "BSE", label: "BSE (India)" },
  { code: "NMS", label: "NASDAQ (US)" },
  { code: "NYQ", label: "NYSE (US)" },
  { code: "LSE", label: "LSE (UK)" },
  { code: "HKG", label: "Hong Kong" },
  { code: "JPX", label: "Tokyo" },
  { code: "TOR", label: "Toronto" },
] as const;

/** Ticker input with a company-name search dropdown — Yahoo Finance symbols
 * (e.g. "RELIANCE.NS") aren't obvious, so this lets a user type a company
 * name and pick from the top 5 closest matches instead of guessing. Typing a
 * ticker directly still works; the dropdown is just a shortcut. An exchange
 * filter narrows results to one exchange — without it, global search results
 * skew toward large US listings and can bury the ones a user actually wants
 * (e.g. NSE-listed Indian stocks) below the top 5. */
function TickerAutocomplete({
  value,
  onChange,
  onSelect,
  exchangeFilter,
}: {
  value: string;
  onChange: (value: string) => void;
  onSelect: (suggestion: StockSuggestion) => void;
  exchangeFilter: string;
}) {
  const [suggestions, setSuggestions] = useState<StockSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextSearchRef = useRef(false);

  useEffect(() => {
    if (skipNextSearchRef.current) {
      skipNextSearchRef.current = false;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const query = value.trim();
    if (query.length < 2) {
      setSuggestions([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      const requestId = ++requestIdRef.current;
      const params = new URLSearchParams({ q: query });
      if (exchangeFilter !== ALL_EXCHANGES) params.set("exchange", exchangeFilter);
      const res = await fetch(`/api/investments/stocks/search?${params}`).catch(() => null);
      if (requestId !== requestIdRef.current) return; // a newer keystroke superseded this request
      const data = await res?.json().catch(() => ({ results: [] }));
      setSuggestions(data?.results || []);
      setSearching(false);
      setOpen(true);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, exchangeFilter]);

  function handleSelect(s: StockSuggestion) {
    skipNextSearchRef.current = true;
    setOpen(false);
    setSuggestions([]);
    onSelect(s);
  }

  return (
    <div className="relative">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onBlur={() => {
          // Delay so a click on a suggestion registers before the list unmounts.
          blurTimeoutRef.current = setTimeout(() => setOpen(false), 150);
        }}
        required
        placeholder="Search by name or ticker…"
        autoComplete="off"
      />
      {open && (searching || suggestions.length > 0) && (
        <div className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto rounded-xl border border-border bg-popover shadow-lg">
          {searching && suggestions.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">Searching…</p>
          ) : (
            suggestions.map((s) => (
              <button
                type="button"
                key={s.symbol}
                onMouseDown={(e) => {
                  e.preventDefault(); // keep focus so onBlur doesn't fire before the click
                  if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
                  handleSelect(s);
                }}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent cursor-pointer"
              >
                <span className="min-w-0">
                  <span className="font-medium">{s.symbol}</span>
                  <span className="block truncate text-xs text-muted-foreground">{s.name}</span>
                </span>
                {s.exchange && (
                  <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[10px] text-muted-foreground">
                    {s.exchange}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function InvestmentsPage() {
  // Category filter: a category id, UNCATEGORISED, or "" for everything.
  const [catFilter, setCatFilter] = useState("");
  return (
    <CategoryProvider onFilter={setCatFilter}>
      <InvestmentsView catFilter={catFilter} setCatFilter={setCatFilter} />
    </CategoryProvider>
  );
}

function InvestmentsView({ catFilter, setCatFilter }: { catFilter: string; setCatFilter: (id: string) => void }) {
  const { user } = useSession();
  const categoryCtx = useCategories()!;
  const reloadCategories = categoryCtx.reload;
  const [managing, setManaging] = useState(false);
  const [tab, setTab] = useState("stocks");
  const priceSeries = usePriceSeries();
  const currency = useCurrency().primary || user?.baseCurrency || "INR";

  const [stocks, setStocks] = useState<StockHolding[]>([]);
  const [funds, setFunds] = useState<MutualFundHolding[]>([]);
  const [deposits, setDeposits] = useState<FixedDeposit[]>([]);
  const [otherAssets, setOtherAssets] = useState<OtherAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [sellTarget, setSellTarget] = useState<SellTarget | null>(null);
  // Date range ("" = open-ended). Holdings narrow to those bought in it,
  // sales to those made in it, and the summary shows the period's activity.
  const [range, setRange] = useState<{ from: string; to: string }>({ from: "", to: "" });

  const load = useCallback(async () => {
    setLoading(true);
    const [sRes, mRes, fRes, oRes, salesRes] = await Promise.all([
      fetch("/api/investments/stocks"),
      fetch("/api/investments/mutual-funds"),
      fetch("/api/investments/fixed-deposits"),
      fetch("/api/investments/other"),
      fetch("/api/investments/sales"),
    ]);
    setStocks((await sRes.json()).holdings || []);
    setFunds((await mRes.json()).holdings || []);
    setDeposits((await fRes.json()).deposits || []);
    setOtherAssets((await oRes.json()).assets || []);
    setSales(salesRes.ok ? (await salesRes.json()).sales || [] : []);
    setLoading(false);
    // Deleting a holding also drops its categories.
    reloadCategories();
  }, [reloadCategories]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRefreshPrices = useCallback(async (silent = false) => {
    setRefreshing(true);
    const res = await fetch("/api/investments/refresh-prices", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setRefreshing(false);
    if (!res.ok) {
      if (!silent) toast.error(data.error || "Failed to refresh prices.");
      return;
    }
    const { stocksUpdated = 0, stocksFailed = 0, fundsUpdated = 0, fundsFailed = 0 } = data;
    if (!silent) {
      if (stocksUpdated + fundsUpdated === 0 && stocksFailed + fundsFailed === 0) {
        toast.info("No holdings with live pricing to refresh.");
      } else if (stocksFailed + fundsFailed > 0) {
        toast.warning(`Updated ${stocksUpdated + fundsUpdated} holding(s); ${stocksFailed + fundsFailed} could not be fetched.`);
      } else {
        toast.success(`Refreshed ${stocksUpdated + fundsUpdated} holding(s).`);
      }
    }
    load();
  }, [load]);

  // Keep prices reasonably fresh while the page is open, without requiring
  // the user to remember to click "Refresh prices" — background refreshes
  // stay silent (no toasts) so they don't interrupt whatever the user's doing.
  useEffect(() => {
    const interval = setInterval(() => handleRefreshPrices(true), 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, [handleRefreshPrices]);

  // Holdings stay in their own currency; totals convert to primary at the
  // shared rates (shown with a note when a rate is missing).
  const fx = useCurrency();
  const toBase = useCallback((amount: number, fromCurrency: string) => fx.toPrimaryAmount(amount, fromCurrency) ?? amount, [fx]);

  const stockValue = useMemo(
    () => stocks.reduce((sum, s) => sum + toBase(Number(s.lastPrice ?? s.avgBuyPrice) * Number(s.quantity), s.currency), 0),
    [stocks, toBase]
  );
  const stockCost = useMemo(
    () => stocks.reduce((sum, s) => sum + toBase(Number(s.avgBuyPrice) * Number(s.quantity), s.currency), 0),
    [stocks, toBase]
  );
  const fundValue = useMemo(
    () => funds.reduce((sum, f) => sum + toBase(Number(f.lastNav ?? f.avgNav) * Number(f.units), f.currency), 0),
    [funds, toBase]
  );
  const fundCost = useMemo(
    () => funds.reduce((sum, f) => sum + toBase(Number(f.avgNav) * Number(f.units), f.currency), 0),
    [funds, toBase]
  );
  const depositValue = useMemo(
    () =>
      deposits.reduce(
        (sum, d) => sum + toBase(fdCurrentValue(Number(d.principal), Number(d.interestRate), d.startDate, d.maturityDate), d.currency),
        0
      ),
    [deposits, toBase]
  );
  const depositCost = useMemo(
    () => deposits.reduce((sum, d) => sum + toBase(Number(d.principal), d.currency), 0),
    [deposits, toBase]
  );
  const otherValue = useMemo(
    () => otherAssets.reduce((sum, a) => sum + toBase(Number(a.currentValue), a.currency), 0),
    [otherAssets, toBase]
  );
  const otherCost = useMemo(
    () => otherAssets.reduce((sum, a) => sum + toBase(Number(a.purchasePrice), a.currency), 0),
    [otherAssets, toBase]
  );

  const realized = useMemo(
    () => sales.filter((x) => !x.reversedAt).reduce((sum, x) => sum + toBase(Number(x.realizedPnl), x.currency), 0),
    [sales, toBase]
  );

  const liveSales = sales.filter((x) => !x.reversedAt).length;
  // Sale proceeds kept for reinvestment are still part of the portfolio (as in net worth).
  const keptProceeds = useMemo(() => sales.reduce((t, x) => t + (x.reversedAt || x.account ? 0 : toBase(x.proceedsLeft ?? 0, x.currency)), 0), [sales, toBase]);
  const totalValue = stockValue + fundValue + depositValue + otherValue + keptProceeds;
  const totalInvested = stockCost + fundCost + depositCost + otherCost;
  const totalGain = stockValue - stockCost + (fundValue - fundCost) + (depositValue - depositCost) + (otherValue - otherCost);

  const ranged = !!(range.from || range.to);
  const inRange = useCallback((d: string) => {
    const day = d.slice(0, 10);
    return (!range.from || day >= range.from) && (!range.to || day <= range.to);
  }, [range]);
  // The period's activity, from the dated purchases and sales themselves.
  const period = useMemo(() => {
    if (!ranged) return null;
    let bought = 0, worth = 0, boughtCount = 0;
    for (const h of stocks) for (const l of h.lots) if (inRange(l.purchaseDate)) {
      bought += toBase(Number(l.quantity) * Number(l.price), h.currency);
      worth += toBase(Number(l.quantity) * Number(h.lastPrice ?? h.avgBuyPrice), h.currency);
      boughtCount++;
    }
    for (const f of funds) for (const l of f.lots ?? []) if (inRange(l.purchaseDate)) {
      bought += toBase(Number(l.units) * Number(l.nav), f.currency);
      worth += toBase(Number(l.units) * Number(f.lastNav ?? f.avgNav), f.currency);
      boughtCount++;
    }
    for (const d of deposits) if (inRange(d.startDate)) {
      bought += toBase(Number(d.principal), d.currency);
      worth += toBase(fdCurrentValue(Number(d.principal), Number(d.interestRate), d.startDate, d.maturityDate), d.currency);
      boughtCount++;
    }
    for (const a of otherAssets) if (inRange(a.purchaseDate)) {
      bought += toBase(Number(a.purchasePrice), a.currency);
      worth += toBase(Number(a.currentValue), a.currency);
      boughtCount++;
    }
    // Purchases made in the period but sold since still count as bought then.
    let boughtSince = 0;
    for (const x of sales) if (!x.reversedAt) for (const l of x.lots) if (inRange(l.purchaseDate)) boughtSince += toBase(Number(l.cost), x.currency);
    const sold = sales.filter((x) => !x.reversedAt && inRange(x.soldOn));
    return {
      bought: bought + boughtSince,
      boughtSince,
      worth,
      boughtCount,
      soldCount: sold.length,
      received: sold.reduce((t, x) => t + toBase(Number(x.netProceeds), x.currency), 0),
      realized: sold.reduce((t, x) => t + toBase(Number(x.realizedPnl), x.currency), 0),
    };
  }, [ranged, inRange, stocks, funds, deposits, otherAssets, sales, toBase]);
  // Every current holding, valued the same way as the totals above, for
  // category figures. Categories only pick which of these to add up.
  const positions = useMemo<Position[]>(
    () => [
      ...stocks.map((h) => ({
        kind: "STOCK" as const,
        id: h.id,
        name: h.ticker,
        currency: h.currency,
        invested: Number(h.avgBuyPrice) * Number(h.quantity),
        value: Number(h.lastPrice ?? h.avgBuyPrice) * Number(h.quantity),
        lots: h.lots.map((l) => ({ qty: Number(l.quantity), cost: Number(l.quantity) * Number(l.price), date: l.purchaseDate })),
      })),
      ...funds.map((f) => ({
        kind: "MUTUAL_FUND" as const,
        id: f.id,
        name: f.fundName,
        currency: f.currency,
        invested: Number(f.avgNav) * Number(f.units),
        value: Number(f.lastNav ?? f.avgNav) * Number(f.units),
        lots: f.lots?.length
          ? f.lots.map((l) => ({ qty: Number(l.units), cost: Number(l.units) * Number(l.nav), date: l.purchaseDate }))
          : [{ qty: Number(f.units), cost: Number(f.units) * Number(f.avgNav), date: f.purchaseDate }],
      })),
      ...deposits.map((d) => ({
        kind: "FIXED_DEPOSIT" as const,
        id: d.id,
        name: `${d.bank} deposit`,
        currency: d.currency,
        invested: Number(d.principal),
        value: fdCurrentValue(Number(d.principal), Number(d.interestRate), d.startDate, d.maturityDate),
        deposit: { principal: Number(d.principal), rate: Number(d.interestRate), start: d.startDate, maturity: d.maturityDate },
      })),
      ...otherAssets.map((a) => ({
        kind: "OTHER" as const,
        id: a.id,
        name: a.name,
        currency: a.currency,
        invested: Number(a.purchasePrice),
        value: Number(a.currentValue),
        valuedOn: a.updatedAt ? a.updatedAt.slice(0, 10) : null,
      })),
    ],
    [stocks, funds, deposits, otherAssets]
  );
  const saleLites = useMemo(() => sales.map((x) => ({ kind: x.kind, holdingId: x.holdingId, currency: x.currency, realizedPnl: Number(x.realizedPnl), reversedAt: x.reversedAt })), [sales]);

  // A removed category can't stay selected.
  const activeCategory = categoryCtx.categories.find((c) => c.id === catFilter) ?? null;
  useEffect(() => {
    if (categoryCtx.loaded && catFilter && catFilter !== UNCATEGORISED && !activeCategory) setCatFilter("");
    if (categoryCtx.loaded && catFilter === UNCATEGORISED && !categoryCtx.categories.length) setCatFilter("");
  }, [categoryCtx.loaded, categoryCtx.categories.length, catFilter, activeCategory, setCatFilter]);
  const inCategory = useMemo(() => {
    if (!catFilter) return null;
    if (catFilter === UNCATEGORISED) {
      const linked = new Set(categoryCtx.categories.flatMap((c) => c.links.map((l) => linkKey(l.kind, l.holdingId))));
      return (kind: InvestmentKind, id: string) => !linked.has(linkKey(kind, id));
    }
    const keys = new Set((activeCategory?.links ?? []).map((l) => linkKey(l.kind, l.holdingId)));
    return (kind: InvestmentKind, id: string) => keys.has(linkKey(kind, id));
  }, [catFilter, categoryCtx.categories, activeCategory]);
  const categoryRow = useMemo(
    () => (activeCategory ? categoryRows([activeCategory], positions, saleLites, toBase, totalValue)[0] : null),
    [activeCategory, positions, saleLites, toBase, totalValue]
  );

  const view = useMemo(() => {
    let v = { stocks, funds, deposits, otherAssets, sales };
    if (ranged) {
      v = {
        stocks: stocks.filter((h) => h.lots.some((l) => inRange(l.purchaseDate))),
        funds: funds.filter((f) => (f.lots?.length ? f.lots.some((l) => inRange(l.purchaseDate)) : inRange(f.purchaseDate))),
        deposits: deposits.filter((d) => inRange(d.startDate)),
        otherAssets: otherAssets.filter((a) => inRange(a.purchaseDate)),
        sales: sales.filter((x) => inRange(x.soldOn)),
      };
    }
    if (inCategory) {
      v = {
        stocks: v.stocks.filter((h) => inCategory("STOCK", h.id)),
        funds: v.funds.filter((f) => inCategory("MUTUAL_FUND", f.id)),
        deposits: v.deposits.filter((d) => inCategory("FIXED_DEPOSIT", d.id)),
        otherAssets: v.otherAssets.filter((a) => inCategory("OTHER", a.id)),
        sales: v.sales.filter((x) => inCategory(x.kind, x.holdingId)),
      };
    }
    return v;
  }, [ranged, inRange, inCategory, stocks, funds, deposits, otherAssets, sales]);
  const narrowed = ranged || !!inCategory;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Investments"
        description="Stocks, funds, deposits and anything else you're growing. The small line shows a year of prices."
        actions={
          <Button variant="outline" onClick={() => handleRefreshPrices(false)} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Refreshing…" : "Refresh prices"}
          </Button>
        }
      />

      <div className="space-y-3">
        <RangeBar range={range} onChange={setRange} />
        <CategoryBar filter={catFilter} onFilter={setCatFilter} onManage={() => setManaging(true)} />
      </div>
      <CategoryManager open={managing} onOpenChange={setManaging} positions={positions} />

      {period ? (
        <Panel className="settle overflow-hidden p-0">
          <div className="grid grid-cols-2 gap-px bg-border lg:grid-cols-4">
            <div className="bg-card p-5">
              <Stat
                label="Bought in this period"
                value={formatMoney(Math.round(period.bought), currency)}
                hint={<><Equivalent both value={period.bought} currency={currency} className="block text-xs" /><span className="block">{period.boughtCount} {period.boughtCount === 1 ? "purchase" : "purchases"} still held{period.boughtSince > 0 ? `, plus ${formatMoney(Math.round(period.boughtSince), currency)} since sold` : ""}</span></>}
              />
            </div>
            <div className="bg-card p-5">
              <Stat
                label="Those still held are worth"
                value={formatMoney(Math.round(period.worth), currency)}
                hint={<><Equivalent both value={period.worth} currency={currency} className="block text-xs" /><span className="block">At today&apos;s prices</span></>}
              />
            </div>
            <div className="bg-card p-5">
              <Stat
                label="Sold in this period"
                value={formatMoney(Math.round(period.received), currency)}
                hint={<><Equivalent both value={period.received} currency={currency} className="block text-xs" /><span className="block">{period.soldCount ? `${period.soldCount} ${period.soldCount === 1 ? "sale or closure" : "sales and closures"}, after charges` : "Nothing sold in this period"}</span></>}
              />
            </div>
            <div className="bg-card p-5">
              <Stat
                label="Realised in this period"
                value={<span className={gainClass(period.realized)}>{period.realized >= 0 ? "+" : "−"}{formatMoney(Math.abs(Math.round(period.realized)), currency)}</span>}
                hint={<><Equivalent both signed value={period.realized} currency={currency} className="block text-xs" /><span className="block">Profit or loss on what was sold</span></>}
              />
            </div>
          </div>
        </Panel>
      ) : (
      <Panel className="settle overflow-hidden p-0">
        <div className="grid grid-cols-2 gap-px bg-border lg:grid-cols-4">
          <div className="bg-card p-5">
            <Stat
              label="Invested"
              value={formatMoney(Math.round(totalInvested), currency)}
              hint={<><Equivalent both value={totalInvested} currency={currency} className="block text-xs" /><span className="block">What your current holdings cost</span></>}
            />
          </div>
          <div className="bg-card p-5">
            <Stat
              label="Current value"
              value={formatMoney(Math.round(totalValue), currency)}
              hint={<><Equivalent both value={totalValue} currency={currency} className="block text-xs" /><span className="block">Stocks and funds {formatMoney(Math.round(stockValue + fundValue), currency)} · deposits and other {formatMoney(Math.round(depositValue + otherValue), currency)}{keptProceeds > 0.5 ? ` · ${formatMoney(Math.round(keptProceeds), currency)} waiting to be reinvested` : ""}</span></>}
            />
          </div>
          <div className="bg-card p-5">
            <Stat
              label="Profit / loss"
              value={<span className={gainClass(totalGain)}>{totalGain >= 0 ? "+" : "−"}{formatMoney(Math.abs(Math.round(totalGain)), currency)}</span>}
              hint={<><Equivalent both signed value={totalGain} currency={currency} className="block text-xs" />{totalInvested > 0 && <span className="block">{((totalGain / totalInvested) * 100).toFixed(1)}% on what you hold now</span>}</>}
            />
          </div>
          <div className="bg-card p-5">
            <Stat
              label="Realised from sales"
              value={<span className={gainClass(realized)}>{realized >= 0 ? "+" : "−"}{formatMoney(Math.abs(Math.round(realized)), currency)}</span>}
              hint={<><Equivalent both signed value={realized} currency={currency} className="block text-xs" /><span className="block">{liveSales ? `From ${liveSales} ${liveSales === 1 ? "sale" : "sales"} and closures` : "Nothing sold yet"}</span></>}
            />
          </div>
        </div>
      </Panel>
      )}
      {ranged && (
        <p className="-mt-2 text-xs text-muted-foreground">
          The tabs show holdings with a purchase in this period (each row still shows the whole holding, so editing stays safe) and sales made in it.
        </p>
      )}
      {categoryRow && (
        <div className="settle -mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-lg border border-border bg-card px-4 py-2.5 text-sm">
          <span className="flex items-center gap-2 font-medium"><Dot color={categoryRow.color} className="h-2.5 w-2.5" />{categoryRow.name}</span>
          <span className="text-muted-foreground">{categoryRow.count} {categoryRow.count === 1 ? "holding" : "holdings"}</span>
          <span>Value <span className="tabular-nums">{formatMoney(Math.round(categoryRow.value), currency)}</span></span>
          <span className={gainClass(categoryRow.pnl)}>
            {categoryRow.pnl >= 0 ? "+" : "−"}{formatMoney(Math.abs(Math.round(categoryRow.pnl)), currency)}
            {categoryRow.pct != null && ` (${categoryRow.pct >= 0 ? "+" : "−"}${Math.abs(categoryRow.pct).toFixed(1)}%)`}
          </span>
          <span className="text-muted-foreground">{categoryRow.allocation.toFixed(1)}% of your portfolio</span>
          <button type="button" onClick={() => setTab("categories")} className="ml-auto cursor-pointer text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">How it has grown</button>
          <span className="basis-full text-xs text-muted-foreground">The totals above are for your whole portfolio; the tabs below show only this category.</span>
        </div>
      )}

      <SellContext.Provider value={setSellTarget}>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="stocks" className="cursor-pointer">Stocks{narrowed ? ` (${view.stocks.length})` : ""}</TabsTrigger>
          <TabsTrigger value="funds" className="cursor-pointer">Mutual funds{narrowed ? ` (${view.funds.length})` : ""}</TabsTrigger>
          <TabsTrigger value="fds" className="cursor-pointer">Fixed deposits{narrowed ? ` (${view.deposits.length})` : ""}</TabsTrigger>
          <TabsTrigger value="other" className="cursor-pointer">Other assets{narrowed ? ` (${view.otherAssets.length})` : ""}</TabsTrigger>
          <TabsTrigger value="categories" className="cursor-pointer">By category</TabsTrigger>
          <TabsTrigger value="sold" className="cursor-pointer">Sold &amp; closed{narrowed ? ` (${view.sales.filter((x) => !x.reversedAt).length})` : liveSales ? ` (${liveSales})` : ""}</TabsTrigger>
        </TabsList>

        <TabsContent value="stocks" className="space-y-4">
          <StockTab stocks={view.stocks} loading={loading} defaultCurrency={currency} onChange={load} />
        </TabsContent>
        <TabsContent value="funds" className="space-y-4">
          <FundTab funds={view.funds} loading={loading} defaultCurrency={currency} onChange={load} />
        </TabsContent>
        <TabsContent value="fds" className="space-y-4">
          <FixedDepositTab deposits={view.deposits} loading={loading} defaultCurrency={currency} onChange={load} />
        </TabsContent>
        <TabsContent value="other" className="space-y-4">
          <OtherAssetTab assets={view.otherAssets} loading={loading} defaultCurrency={currency} onChange={load} />
        </TabsContent>
        <TabsContent value="categories" className="space-y-4">
          <CategoryPerformance
            positions={positions}
            sales={saleLites}
            series={priceSeries}
            toBase={toBase}
            currency={currency}
            portfolioValue={totalValue}
            selected={activeCategory?.id ?? ""}
            onSelect={setCatFilter}
            range={range}
            onManage={() => setManaging(true)}
          />
        </TabsContent>
        <TabsContent value="sold" className="space-y-4">
          <SalesHistory sales={view.sales} loading={loading} onChanged={load} />
        </TabsContent>
      </Tabs>
      </SellContext.Provider>
      <SellDialog target={sellTarget} onOpenChange={(o) => !o && setSellTarget(null)} onSold={load} />
    </div>
  );
}

function StockTab({
  stocks,
  loading,
  defaultCurrency,
  onChange,
}: {
  stocks: StockHolding[];
  loading: boolean;
  defaultCurrency: string;
  onChange: () => void;
}) {
  const series = usePriceSeries();
  const [open, setOpen] = useState(false);
  const [funding, setFunding] = useState<FundingValue>(emptyFunding);
  const [cats, setCats] = useState<PickerValue>(emptyPicker);
  const [saving, setSaving] = useState(false);
  const [ticker, setTicker] = useState("");
  const [exchange, setExchange] = useState("");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().slice(0, 10));
  // Defaults to NSE for INR users — the exchange most likely to be searched
  // for by this app's primary (Indian) audience.
  const [searchExchange, setSearchExchange] = useState(defaultCurrency === "INR" ? "NSI" : ALL_EXCHANGES);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editExchange, setEditExchange] = useState("");
  const [editQuantity, setEditQuantity] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const [detailsId, setDetailsId] = useState<string | null>(null);
  const detailsHolding = stocks.find((s) => s.id === detailsId) || null;
  const editingHolding = stocks.find((s) => s.id === editingId) || null;

  const [editingLot, setEditingLot] = useState<{ holdingId: string; lot: StockPurchaseLot } | null>(null);
  const [lotQuantity, setLotQuantity] = useState("");
  const [lotPrice, setLotPrice] = useState("");
  const [lotDate, setLotDate] = useState("");
  const [lotSaving, setLotSaving] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch("/api/investments/stocks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker, exchange, quantity, price, currency, purchaseDate, ...fundingBody(funding) }),
    });
    setSaving(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(data.error || "Failed to add stock.");
    if (data.holding?.id) await assignCategories("STOCK", data.holding.id, cats);
    setCats(emptyPicker());
    setOpen(false);
    setFunding(emptyFunding());
    setTicker("");
    setQuantity("");
    setPrice("");
    toast.success(
      data.merged
        ? "Added as a new purchase of a stock you already hold."
        : "Stock added."
    );
    onChange();
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/investments/stocks/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Removed.");
      onChange();
    }
  }

  function openEdit(s: StockHolding) {
    setEditingId(s.id);
    setEditExchange(s.exchange || "");
    setEditQuantity(s.quantity);
    setEditPrice(s.avgBuyPrice);
  }

  async function handleEditSave(e: React.FormEvent) {
    e.preventDefault();
    if (!editingHolding) return;
    setEditSaving(true);
    const singleLot = editingHolding.lots.length <= 1;
    const res = await fetch(`/api/investments/stocks/${editingHolding.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        exchange: editExchange,
        ...(singleLot ? { quantity: editQuantity, avgBuyPrice: editPrice } : {}),
      }),
    });
    setEditSaving(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(data.error || "Failed to update stock.");
    setEditingId(null);
    toast.success("Stock updated.");
    onChange();
  }

  function openLotEdit(holdingId: string, lot: StockPurchaseLot) {
    setEditingLot({ holdingId, lot });
    setLotQuantity(lot.quantity);
    setLotPrice(lot.price);
    setLotDate(lot.purchaseDate.slice(0, 10));
  }

  async function handleLotSave(e: React.FormEvent) {
    e.preventDefault();
    if (!editingLot) return;
    setLotSaving(true);
    const res = await fetch(`/api/investments/stocks/${editingLot.holdingId}/lots/${editingLot.lot.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantity: lotQuantity, price: lotPrice, purchaseDate: lotDate }),
    });
    setLotSaving(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(data.error || "Failed to update purchase.");
    setEditingLot(null);
    toast.success("Purchase updated.");
    onChange();
  }

  async function handleLotDelete(holdingId: string, lotId: string) {
    const res = await fetch(`/api/investments/stocks/${holdingId}/lots/${lotId}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(data.error || "Failed to remove purchase.");
    toast.success(
      data.holdingDeleted ? "Purchase removed. It was the only one, so the holding went too." : "Purchase removed."
    );
    onChange();
    if (data.holdingDeleted) setDetailsId(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="cursor-pointer"><Plus className="h-4 w-4" />Add stock</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>Add a stock</DialogTitle></DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label>Search in</Label>
                <Select value={searchExchange} onValueChange={setSearchExchange}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EXCHANGE_FILTERS.map((e) => (
                      <SelectItem key={e.code} value={e.code}>{e.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Ticker</Label>
                  <TickerAutocomplete
                    value={ticker}
                    onChange={setTicker}
                    onSelect={(s) => {
                      setTicker(s.symbol);
                      if (!exchange) setExchange(s.exchange);
                    }}
                    exchangeFilter={searchExchange}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Exchange</Label>
                  <Input value={exchange} onChange={(e) => setExchange(e.target.value)} placeholder="Optional" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Quantity</Label>
                  <Input type="number" step="0.0001" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label>Price paid</Label>
                  <Input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} required />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Currency</Label>
                  <Select value={currency} onValueChange={setCurrency}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SUPPORTED_CURRENCIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Bought on</Label>
                  <Input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} required />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Already own this stock? Adding it again with the same ticker, exchange, and currency combines it into
                your existing holding and averages the price. No duplicate row.
              </p>
              <CategoryField value={cats} onChange={setCats} />
              <FundingFields value={funding} onChange={setFunding} currency={currency} cost={Number(quantity) * Number(price)} />
              <DialogFooter>
                <Button type="submit" disabled={saving} className="w-full cursor-pointer">{saving ? "Adding…" : "Add"}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <StockTable stocks={stocks} loading={loading} series={series} onView={setDetailsId} onEdit={openEdit} onDelete={handleDelete} />

      {/* Edit holding */}
      <Dialog open={!!editingId} onOpenChange={(o) => !o && setEditingId(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Edit {editingHolding?.ticker}</DialogTitle></DialogHeader>
          {editingHolding && (
            <form onSubmit={handleEditSave} className="space-y-4">
              <div className="space-y-2">
                <Label>Exchange</Label>
                <Input value={editExchange} onChange={(e) => setEditExchange(e.target.value)} placeholder="Optional" />
              </div>
              {editingHolding.lots.length <= 1 ? (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Quantity</Label>
                    <Input type="number" step="0.0001" value={editQuantity} onChange={(e) => setEditQuantity(e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label>Average price</Label>
                    <Input type="number" step="0.01" value={editPrice} onChange={(e) => setEditPrice(e.target.value)} required />
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  This holding has {editingHolding.lots.length} separate purchases, so quantity and average price are
                  derived from them. Use &quot;View purchases&quot; to fix an individual one.
                </p>
              )}
              <DialogFooter>
                <Button type="submit" disabled={editSaving} className="w-full cursor-pointer">{editSaving ? "Saving…" : "Save changes"}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Purchase breakdown */}
      <Dialog open={!!detailsId} onOpenChange={(o) => !o && setDetailsId(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
          {detailsHolding && <StockBreakdown h={detailsHolding} onEditLot={(lot) => openLotEdit(detailsHolding.id, lot)} onDeleteLot={(lotId) => handleLotDelete(detailsHolding.id, lotId)} />}
        </DialogContent>
      </Dialog>

      {/* Edit a single purchase */}
      <Dialog open={!!editingLot} onOpenChange={(o) => !o && setEditingLot(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Edit purchase</DialogTitle></DialogHeader>
          <form onSubmit={handleLotSave} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Quantity</Label>
                <Input type="number" step="0.0001" value={lotQuantity} onChange={(e) => setLotQuantity(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>Price</Label>
                <Input type="number" step="0.01" value={lotPrice} onChange={(e) => setLotPrice(e.target.value)} required />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Bought on</Label>
              <Input type="date" value={lotDate} onChange={(e) => setLotDate(e.target.value)} required />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={lotSaving} className="w-full cursor-pointer">{lotSaving ? "Saving…" : "Save"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FundTab({
  funds,
  loading,
  defaultCurrency,
  onChange,
}: {
  funds: MutualFundHolding[];
  loading: boolean;
  defaultCurrency: string;
  onChange: () => void;
}) {
  const series = usePriceSeries();
  const [open, setOpen] = useState(false);
  const [funding, setFunding] = useState<FundingValue>(emptyFunding);
  const [cats, setCats] = useState<PickerValue>(emptyPicker);
  const [saving, setSaving] = useState(false);
  const [fundName, setFundName] = useState("");
  const [schemeCode, setSchemeCode] = useState("");
  const [units, setUnits] = useState("");
  const [avgNav, setAvgNav] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().slice(0, 10));

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch("/api/investments/mutual-funds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fundName, schemeCode, units, avgNav, currency, purchaseDate, ...fundingBody(funding) }),
    });
    setSaving(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(data.error || "Failed to add fund.");
    if (data.holding?.id) await assignCategories("MUTUAL_FUND", data.holding.id, cats);
    setCats(emptyPicker());
    setOpen(false);
    setFunding(emptyFunding());
    setFundName("");
    setUnits("");
    setAvgNav("");
    toast.success(data.merged ? "Added as a new purchase of a fund you already hold." : "Fund added.");
    onChange();
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/investments/mutual-funds/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Removed.");
      onChange();
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="cursor-pointer"><Plus className="h-4 w-4" />Add fund</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>Add a fund</DialogTitle></DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label>Fund name</Label>
                <Input value={fundName} onChange={(e) => setFundName(e.target.value)} required placeholder="Parag Parikh Flexi Cap" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>AMFI Scheme Code</Label>
                  <Input value={schemeCode} onChange={(e) => setSchemeCode(e.target.value)} placeholder="Optional. Turns on automatic NAV updates." />
                </div>
                <div className="space-y-2">
                  <Label>Currency</Label>
                  <Select value={currency} onValueChange={setCurrency}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SUPPORTED_CURRENCIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Units</Label>
                  <Input type="number" step="0.001" value={units} onChange={(e) => setUnits(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label>Average NAV</Label>
                  <Input type="number" step="0.01" value={avgNav} onChange={(e) => setAvgNav(e.target.value)} required />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Bought on</Label>
                <Input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} required />
              </div>
              <CategoryField value={cats} onChange={setCats} />
              <FundingFields value={funding} onChange={setFunding} currency={currency} cost={Number(units) * Number(avgNav)} />
              <DialogFooter>
                <Button type="submit" disabled={saving} className="w-full cursor-pointer">{saving ? "Adding…" : "Add"}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <FundTable funds={funds} loading={loading} series={series} onDelete={handleDelete} onChanged={onChange} />
    </div>
  );
}

function FixedDepositTab({
  deposits,
  loading,
  defaultCurrency,
  onChange,
}: {
  deposits: FixedDeposit[];
  loading: boolean;
  defaultCurrency: string;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [funding, setFunding] = useState<FundingValue>(emptyFunding);
  const [cats, setCats] = useState<PickerValue>(emptyPicker);
  const [saving, setSaving] = useState(false);
  const [bank, setBank] = useState("");
  const [principal, setPrincipal] = useState("");
  const [interestRate, setInterestRate] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [maturityDate, setMaturityDate] = useState("");

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch("/api/investments/fixed-deposits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bank, principal, interestRate, currency, startDate, maturityDate, ...fundingBody(funding) }),
    });
    setSaving(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(data.error || "Failed to add fixed deposit.");
    if (data.deposit?.id) await assignCategories("FIXED_DEPOSIT", data.deposit.id, cats);
    setCats(emptyPicker());
    setOpen(false);
    setFunding(emptyFunding());
    setBank("");
    setPrincipal("");
    setInterestRate("");
    setMaturityDate("");
    toast.success("Fixed deposit added.");
    onChange();
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/investments/fixed-deposits/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Removed.");
      onChange();
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="cursor-pointer"><Plus className="h-4 w-4" />Add deposit</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>Add deposit</DialogTitle></DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label>Bank</Label>
                <Input value={bank} onChange={(e) => setBank(e.target.value)} required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Principal</Label>
                  <Input type="number" step="0.01" value={principal} onChange={(e) => setPrincipal(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label>Interest Rate (%)</Label>
                  <Input type="number" step="0.01" value={interestRate} onChange={(e) => setInterestRate(e.target.value)} required />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Start date</Label>
                  <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label>Matures on</Label>
                  <Input type="date" value={maturityDate} onChange={(e) => setMaturityDate(e.target.value)} required />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Currency</Label>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SUPPORTED_CURRENCIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <CategoryField value={cats} onChange={setCats} />
              <FundingFields value={funding} onChange={setFunding} currency={currency} cost={Number(principal)} />
              <DialogFooter>
                <Button type="submit" disabled={saving} className="w-full cursor-pointer">{saving ? "Adding…" : "Add"}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <DepositTable deposits={deposits} loading={loading} onDelete={handleDelete} />
    </div>
  );
}

function OtherAssetTab({
  assets,
  loading,
  defaultCurrency,
  onChange,
}: {
  assets: OtherAsset[];
  loading: boolean;
  defaultCurrency: string;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [funding, setFunding] = useState<FundingValue>(emptyFunding);
  const [cats, setCats] = useState<PickerValue>(emptyPicker);
  const [saving, setSaving] = useState(false);
  const [assetType, setAssetType] = useState("GOLD");
  const [name, setName] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [currentValue, setCurrentValue] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().slice(0, 10));

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch("/api/investments/other", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetType, name, purchasePrice, currentValue, currency, purchaseDate, ...fundingBody(funding) }),
    });
    setSaving(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(data.error || "Failed to add asset.");
    if (data.asset?.id) await assignCategories("OTHER", data.asset.id, cats);
    setCats(emptyPicker());
    setOpen(false);
    setFunding(emptyFunding());
    setName("");
    setPurchasePrice("");
    setCurrentValue("");
    toast.success("Asset added.");
    onChange();
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/investments/other/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Removed.");
      onChange();
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="cursor-pointer"><Plus className="h-4 w-4" />Add asset</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>Add an asset</DialogTitle></DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select value={assetType} onValueChange={setAssetType}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {OTHER_ASSET_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="24K Gold Coins" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Price paid</Label>
                  <Input type="number" step="0.01" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label>Value now</Label>
                  <Input type="number" step="0.01" value={currentValue} onChange={(e) => setCurrentValue(e.target.value)} required />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Currency</Label>
                  <Select value={currency} onValueChange={setCurrency}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SUPPORTED_CURRENCIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Bought on</Label>
                  <Input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} required />
                </div>
              </div>
              <CategoryField value={cats} onChange={setCats} />
              <FundingFields value={funding} onChange={setFunding} currency={currency} cost={Number(purchasePrice)} />
              <DialogFooter>
                <Button type="submit" disabled={saving} className="w-full cursor-pointer">{saving ? "Adding…" : "Add"}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <AssetTable assets={assets} loading={loading} typeLabel={(t) => OTHER_ASSET_TYPES.find((x) => x.value === t)?.label ?? t} onDelete={handleDelete} onChanged={onChange} />
    </div>
  );
}

/** Start → end date filter with quick presets. */
function RangeBar({ range, onChange }: { range: { from: string; to: string }; onChange: (r: { from: string; to: string }) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const y = today.slice(0, 4);
  const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const presets: [string, { from: string; to: string }][] = [
    ["All time", { from: "", to: "" }],
    ["This year", { from: `${y}-01-01`, to: today }],
    ["Last 12 months", { from: yearAgo, to: today }],
    ["Last year", { from: `${Number(y) - 1}-01-01`, to: `${Number(y) - 1}-12-31` }],
  ];
  const active = presets.find(([, r]) => r.from === range.from && r.to === range.to)?.[0];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="radiogroup" aria-label="Period" className="inline-flex rounded-lg bg-muted p-0.5 text-xs">
        {presets.map(([label, r]) => (
          <button key={label} role="radio" aria-checked={active === label} onClick={() => onChange(r)} className={`h-7 cursor-pointer rounded-md px-2.5 transition-colors ${active === label ? "bg-card font-medium shadow-card" : "text-muted-foreground hover:text-foreground"}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Input type="date" aria-label="From" value={range.from} max={range.to || undefined} onChange={(e) => onChange({ ...range, from: e.target.value })} className="h-8 w-[150px]" />
        <span aria-hidden>→</span>
        <Input type="date" aria-label="To" value={range.to} min={range.from || undefined} onChange={(e) => onChange({ ...range, to: e.target.value })} className="h-8 w-[150px]" />
      </div>
    </div>
  );
}
