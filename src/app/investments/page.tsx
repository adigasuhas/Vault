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
import { CategoryBar, CategoryField, CategoryManager, CategoryPerformance, CategoryPicker, CategoryProvider, Dot, UNCATEGORISED, assignCategories, emptyPicker, pickerEmpty, useCategories, type PickerValue } from "@/components/investments/Categories";
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
  /** How it was paid; null when it's only tracked. */
  paidFrom?: { kind: "ACCOUNT" | "SALE"; name: string; amount?: string; currency?: string } | null;
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
  /** Sales recorded against it (not undone). */
  saleCount?: number;
  /** Set when the row shows only some purchases (a category filter): the
   * whole holding's quantity. */
  partOf?: number;
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
  // A value it opens with (editing a stock) is already chosen: no search
  // until it is changed.
  const openedWithRef = useRef(value.trim());

  useEffect(() => {
    if (skipNextSearchRef.current) {
      skipNextSearchRef.current = false;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const query = value.trim();
    if (openedWithRef.current) {
      if (query === openedWithRef.current) return;
      openedWithRef.current = "";
    }
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
        lots: h.lots.map((l) => ({ id: l.id, qty: Number(l.quantity), cost: Number(l.quantity) * Number(l.price), date: l.purchaseDate })),
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
  const saleLites = useMemo(
    () =>
      sales.map((x) => ({
        kind: x.kind,
        holdingId: x.holdingId,
        currency: x.currency,
        realizedPnl: Number(x.realizedPnl),
        reversedAt: x.reversedAt,
        quantity: x.quantity != null ? Number(x.quantity) : null,
        netProceeds: Number(x.netProceeds),
        lots: x.lots.map((l) => ({ lotId: l.lotId, quantity: l.quantity != null ? Number(l.quantity) : null, cost: Number(l.cost) })),
      })),
    [sales]
  );

  // A removed category can't stay selected.
  const activeCategory = categoryCtx.categories.find((c) => c.id === catFilter) ?? null;
  useEffect(() => {
    if (categoryCtx.loaded && catFilter && catFilter !== UNCATEGORISED && !activeCategory) setCatFilter("");
    if (categoryCtx.loaded && catFilter === UNCATEGORISED && !categoryCtx.categories.length) setCatFilter("");
  }, [categoryCtx.loaded, categoryCtx.categories.length, catFilter, activeCategory, setCatFilter]);
  // What the category filter keeps: whole holdings, or, for stocks split by
  // purchase (clients), just the purchases in it.
  const inCategory = useMemo(() => {
    if (!catFilter) return null;
    if (catFilter === UNCATEGORISED) {
      const linked = new Set(categoryCtx.categories.flatMap((c) => c.links.map((l) => linkKey(l.kind, l.holdingId))));
      const lots = new Set(categoryCtx.categories.flatMap((c) => (c.lotLinks ?? []).map((l) => l.lotId)));
      return { holding: (kind: InvestmentKind, id: string) => !linked.has(linkKey(kind, id)), lot: (lotId: string) => !lots.has(lotId), whole: () => false };
    }
    const keys = new Set((activeCategory?.links ?? []).map((l) => linkKey(l.kind, l.holdingId)));
    const lots = new Set((activeCategory?.lotLinks ?? []).map((l) => l.lotId));
    return { holding: (kind: InvestmentKind, id: string) => keys.has(linkKey(kind, id)), lot: (lotId: string) => lots.has(lotId), whole: (kind: InvestmentKind, id: string) => keys.has(linkKey(kind, id)) };
  }, [catFilter, categoryCtx.categories, activeCategory]);
  /** A stock narrowed to the purchases the filter keeps: its row then shows
   * only those shares, at their own cost. */
  const stockIn = useCallback(
    (h: StockHolding): StockHolding | null => {
      if (!inCategory) return h;
      if (inCategory.whole("STOCK", h.id)) return h;
      // "Not in a category": a stock in one as a whole is out entirely.
      if (catFilter === UNCATEGORISED && !inCategory.holding("STOCK", h.id)) return null;
      const lots = h.lots.filter((l) => inCategory.lot(l.id));
      if (!lots.length) return catFilter === UNCATEGORISED && !h.lots.length ? h : null;
      if (lots.length === h.lots.length) return h;
      const qty = lots.reduce((t, l) => t + Number(l.quantity), 0);
      const cost = lots.reduce((t, l) => t + Number(l.quantity) * Number(l.price), 0);
      return { ...h, lots, quantity: String(qty), avgBuyPrice: String(qty ? cost / qty : 0), partOf: Number(h.quantity) };
    },
    [inCategory, catFilter]
  );
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
        stocks: v.stocks.map(stockIn).filter((h): h is StockHolding => !!h),
        funds: v.funds.filter((f) => inCategory.holding("MUTUAL_FUND", f.id)),
        deposits: v.deposits.filter((d) => inCategory.holding("FIXED_DEPOSIT", d.id)),
        otherAssets: v.otherAssets.filter((a) => inCategory.holding("OTHER", a.id)),
        sales: v.sales.filter((x) =>
          catFilter === UNCATEGORISED
            ? inCategory.holding(x.kind, x.holdingId) && (x.kind !== "STOCK" || x.lots.some((l) => !l.lotId || inCategory.lot(l.lotId)))
            : inCategory.holding(x.kind, x.holdingId) || (x.kind === "STOCK" && x.lots.some((l) => l.lotId && inCategory.lot(l.lotId)))
        ),
      };
    }
    return v;
  }, [ranged, inRange, inCategory, stockIn, catFilter, stocks, funds, deposits, otherAssets, sales]);
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
          <StockTab stocks={view.stocks} allStocks={stocks} loading={loading} defaultCurrency={currency} onChange={load} />
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
  allStocks,
  loading,
  defaultCurrency,
  onChange,
}: {
  stocks: StockHolding[];
  /** Every stock in full: rows may show only some purchases (a category
   * filter), but details and editing always work on the whole stock. */
  allStocks: StockHolding[];
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
  // Categories picked when adding: this purchase only (a client) or every share.
  const [catScope, setCatScope] = useState<"PURCHASE" | "STOCK">("PURCHASE");

  // One edit form for every way in: the row's Edit, and Edit / a purchase's
  // pencil in its details. focusLot puts the cursor on that purchase.
  const [editing, setEditing] = useState<{ id: string; focusLot?: string } | null>(null);

  const [detailsId, setDetailsId] = useState<string | null>(null);
  const detailsHolding = allStocks.find((s) => s.id === detailsId) || null;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch("/api/investments/stocks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ticker,
        exchange,
        quantity,
        price,
        currency,
        purchaseDate,
        ...fundingBody(funding),
        ...(pickerEmpty(cats) ? {} : { categoryIds: cats.ids, newNames: cats.newNames, categoryScope: catScope }),
      }),
    });
    setSaving(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(data.error || "Failed to add stock.");
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
              <div className="space-y-2">
                <CategoryField value={cats} onChange={setCats} />
                {!pickerEmpty(cats) && (
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-muted-foreground">Applies to</span>
                    <div role="radiogroup" aria-label="Categories apply to" className="inline-flex rounded-md bg-muted p-0.5">
                      {([["PURCHASE", "This purchase"], ["STOCK", "Every share of it"]] as const).map(([v, l]) => (
                        <button key={v} type="button" role="radio" aria-checked={catScope === v} onClick={() => setCatScope(v)} className={`h-7 cursor-pointer rounded px-2.5 transition-colors ${catScope === v ? "bg-card font-medium shadow-card" : "text-muted-foreground hover:text-foreground"}`}>
                          {l}
                        </button>
                      ))}
                    </div>
                    <span className="basis-full text-muted-foreground">
                      {catScope === "PURCHASE" ? "Just these shares, e.g. the client they're for. Other purchases of it keep their own." : "Every share, now and later, e.g. an industry."}
                    </span>
                  </div>
                )}
              </div>
              <FundingFields value={funding} onChange={setFunding} currency={currency} cost={Number(quantity) * Number(price)} />
              <DialogFooter>
                <Button type="submit" disabled={saving} className="w-full cursor-pointer">{saving ? "Adding…" : "Add"}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <StockTable stocks={stocks} loading={loading} series={series} onView={setDetailsId} onEdit={(s) => setEditing({ id: s.id })} onDelete={handleDelete} />

      <StockEditor
        holding={editing ? allStocks.find((s) => s.id === editing.id) ?? null : null}
        focusLot={editing?.focusLot}
        onClose={() => setEditing(null)}
        onSaved={onChange}
      />

      {/* Purchase breakdown */}
      <Dialog open={!!detailsId} onOpenChange={(o) => !o && setDetailsId(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
          {detailsHolding && <StockBreakdown h={detailsHolding} onEdit={() => setEditing({ id: detailsHolding.id })} onEditLot={(lot) => setEditing({ id: detailsHolding.id, focusLot: lot.id })} onDeleteLot={(lotId) => handleLotDelete(detailsHolding.id, lotId)} />}
        </DialogContent>
      </Dialog>

    </div>
  );
}

/** Edit a stock: the same fields as adding one (ticker, exchange, currency,
 * each purchase's quantity, price and date, categories), with how each
 * purchase was paid shown but kept as recorded. Every way into editing a
 * stock opens this, and it saves through one request. */
function StockEditor({ holding, focusLot, onClose, onSaved }: { holding: StockHolding | null; focusLot?: string; onClose: () => void; onSaved: () => void }) {
  return (
    <Dialog open={!!holding} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"
        onOpenAutoFocus={(e) => {
          // Opened from a purchase's pencil: start on that purchase.
          const el = focusLot ? document.getElementById(`lot-quantity-${focusLot}`) : null;
          if (el) {
            e.preventDefault();
            el.focus();
          }
        }}
      >
        <DialogHeader><DialogTitle>Edit {holding?.ticker}</DialogTitle></DialogHeader>
        {/* Keyed so it starts from the stock's saved values each time it opens. */}
        {holding && <StockEditForm key={`${holding.id}:${focusLot ?? ""}`} holding={holding} focusLot={focusLot} onClose={onClose} onSaved={onSaved} />}
      </DialogContent>
    </Dialog>
  );
}

function StockEditForm({ holding, focusLot, onClose, onSaved }: { holding: StockHolding; focusLot?: string; onClose: () => void; onSaved: () => void }) {
  const categoryCtx = useCategories();
  const lotsInOrder = useMemo(() => [...holding.lots].sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate)), [holding.lots]);
  const [searchExchange, setSearchExchange] = useState(holding.currency === "INR" ? "NSI" : ALL_EXCHANGES);
  const [ticker, setTicker] = useState(holding.ticker);
  const [exchange, setExchange] = useState(holding.exchange ?? "");
  const [currency, setCurrency] = useState(holding.currency);
  const [lots, setLots] = useState(() =>
    Object.fromEntries(lotsInOrder.map((l) => [l.id, { quantity: String(Number(l.quantity)), price: String(Number(l.price)), date: l.purchaseDate.slice(0, 10) }]))
  );
  const initialCats = useMemo(() => (categoryCtx?.of("STOCK", holding.id) ?? []).map((c) => c.id), [categoryCtx, holding.id]);
  const [cats, setCats] = useState<PickerValue>(() => ({ ids: initialCats, newNames: [] }));
  // Each purchase's own categories (e.g. the client it was bought for).
  const initialLotCats = useMemo(() => Object.fromEntries(lotsInOrder.map((l) => [l.id, (categoryCtx?.ofLot(l.id) ?? []).map((c) => c.id)])), [categoryCtx, lotsInOrder]);
  const [lotCats, setLotCats] = useState<Record<string, PickerValue>>(() => Object.fromEntries(lotsInOrder.map((l) => [l.id, { ids: initialLotCats[l.id], newNames: [] }])));
  const changed = (v: PickerValue, was: string[]) => v.newNames.length > 0 || v.ids.length !== was.length || v.ids.some((id) => !was.includes(id));
  const [saving, setSaving] = useState(false);

  const paidAny = holding.lots.some((l) => l.paidFrom);
  const currencyLocked = paidAny || (holding.saleCount ?? 0) > 0;
  const single = lotsInOrder.length === 1;
  const setLot = (id: string, patch: Partial<(typeof lots)[string]>) => setLots((all) => ({ ...all, [id]: { ...all[id], ...patch } }));
  const totals = lotsInOrder.reduce((t, l) => ({ qty: t.qty + Number(lots[l.id].quantity || 0), cost: t.cost + Number(lots[l.id].quantity || 0) * Number(lots[l.id].price || 0) }), { qty: 0, cost: 0 });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const t = ticker.trim().toUpperCase();
    if (!t) return toast.error("Enter the ticker.");
    const lotEdits: { id: string; quantity?: number; price?: number; purchaseDate?: string; categoryIds?: string[]; newNames?: string[] }[] = [];
    for (const l of lotsInOrder) {
      const v = lots[l.id];
      const q = Number(v.quantity);
      const p = Number(v.price);
      if (!(q > 0) || !(p > 0)) return toast.error("Each purchase needs a quantity and price above zero.");
      if (!v.date) return toast.error("Each purchase needs the date it was bought.");
      const own = lotCats[l.id];
      const edit = {
        ...(q !== Number(l.quantity) ? { quantity: q } : {}),
        ...(p !== Number(l.price) ? { price: p } : {}),
        ...(v.date !== l.purchaseDate.slice(0, 10) ? { purchaseDate: v.date } : {}),
        ...(changed(own, initialLotCats[l.id]) ? { categoryIds: own.ids, newNames: own.newNames } : {}),
      };
      if (Object.keys(edit).length) lotEdits.push({ id: l.id, ...edit });
    }
    const catsChanged = changed(cats, initialCats);
    const body = {
      ...(t !== holding.ticker ? { ticker: t } : {}),
      ...((exchange.trim() || null) !== holding.exchange ? { exchange: exchange.trim() || null } : {}),
      ...(currency !== holding.currency ? { currency } : {}),
      ...(lotEdits.length ? { lots: lotEdits } : {}),
      ...(catsChanged ? { categoryIds: cats.ids, newNames: cats.newNames } : {}),
    };
    if (!Object.keys(body).length) return onClose();
    setSaving(true);
    const res = await fetch(`/api/investments/stocks/${holding.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setSaving(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(data.error || "Couldn't save the changes.");
    toast.success("Stock updated.");
    onClose();
    onSaved();
  }

  const paidNote = (l: StockPurchaseLot) =>
    !l.paidFrom
      ? "Only tracked: no account or budget was changed."
      : l.paidFrom.kind === "ACCOUNT"
        ? `Paid from ${l.paidFrom.name}${l.paidFrom.amount ? ` · ${formatMoney(Number(l.paidFrom.amount), l.paidFrom.currency ?? holding.currency)}` : ""}. A new cost re-books that payment.`
        : `Paid from the ${l.paidFrom.name} sale's proceeds. A new cost updates that reinvestment.`;

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="space-y-2">
        <Label>Search in</Label>
        <Select value={searchExchange} onValueChange={setSearchExchange}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            {EXCHANGE_FILTERS.map((e) => <SelectItem key={e.code} value={e.code}>{e.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Ticker</Label>
          <TickerAutocomplete value={ticker} onChange={setTicker} onSelect={(s) => { setTicker(s.symbol); setExchange(s.exchange); }} exchangeFilter={searchExchange} />
        </div>
        <div className="space-y-2">
          <Label>Exchange</Label>
          <Input value={exchange} onChange={(e) => setExchange(e.target.value)} placeholder="Optional" aria-label="Exchange" />
        </div>
      </div>
      {ticker.trim().toUpperCase() !== holding.ticker && (
        <p className="-mt-2 text-xs text-muted-foreground">Its price is fetched again for the new ticker. Sales already recorded keep the name they were sold under.</p>
      )}
      <div className="space-y-2">
        <Label>Currency</Label>
        <Select value={currency} onValueChange={setCurrency} disabled={currencyLocked}>
          <SelectTrigger className="w-full" aria-label="Currency"><SelectValue /></SelectTrigger>
          <SelectContent>{SUPPORTED_CURRENCIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>)}</SelectContent>
        </Select>
        {currencyLocked && (
          <p className="text-xs text-muted-foreground">
            Fixed at {holding.currency}: {paidAny ? "a purchase was paid for in it" : "it has sales recorded in it"}. To change it, delete {paidAny ? "that purchase" : "this stock"} and add it again in the right currency.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <Label>{single ? "Purchase" : `Purchases (${lotsInOrder.length})`}</Label>
          {!single && <span className="text-xs text-muted-foreground tabular-nums">{Number(totals.qty.toFixed(4))} shares · avg {formatMoney(totals.qty ? totals.cost / totals.qty : 0, currency)}</span>}
        </div>
        <div className="space-y-2">
          {lotsInOrder.map((l, i) => (
            <div key={l.id} className={`space-y-2 rounded-lg border p-3 ${focusLot === l.id ? "border-foreground/40 bg-muted/40" : "border-border"}`}>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Quantity</Label>
                  <Input type="number" step="0.0001" min="0" value={lots[l.id].quantity} onChange={(e) => setLot(l.id, { quantity: e.target.value })} required id={`lot-quantity-${l.id}`} aria-label={`Quantity, purchase ${i + 1}`} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Price paid</Label>
                  <Input type="number" step="0.01" min="0" value={lots[l.id].price} onChange={(e) => setLot(l.id, { price: e.target.value })} required aria-label={`Price, purchase ${i + 1}`} />
                </div>
                <div className="col-span-2 space-y-1.5 sm:col-span-1">
                  <Label className="text-xs text-muted-foreground">Bought on</Label>
                  <Input type="date" value={lots[l.id].date} onChange={(e) => setLot(l.id, { date: e.target.value })} required aria-label={`Date, purchase ${i + 1}`} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{paidNote(l)}</p>
              <div className="space-y-1.5 border-t border-border/70 pt-2">
                <Label className="text-xs text-muted-foreground">{single ? "Categories for this purchase" : `Categories for these ${Number(lots[l.id].quantity) || ""} shares`}</Label>
                <CategoryPicker compact value={lotCats[l.id]} onChange={(v) => setLotCats((all) => ({ ...all, [l.id]: v }))} categories={categoryCtx?.categories ?? []} />
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          How a purchase was paid stays as recorded; it&apos;s part of that account&apos;s history. To change it, delete the purchase from the stock&apos;s details and add it again.{!single && " Quantity and average price are worked out from these purchases."}
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>Categories for the whole stock <span className="font-normal text-muted-foreground">(optional)</span></Label>
        <p className="text-xs text-muted-foreground">Every share, now and later, e.g. an industry. Use a purchase&apos;s own categories above for who it was bought for.</p>
        <CategoryPicker value={cats} onChange={setCats} categories={categoryCtx?.categories ?? []} />
      </div>

      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
      </DialogFooter>
    </form>
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
      <div role="radiogroup" aria-label="Period" className="inline-flex max-w-full overflow-x-auto rounded-lg bg-muted p-0.5 text-xs">
        {presets.map(([label, r]) => (
          <button key={label} role="radio" aria-checked={active === label} onClick={() => onChange(r)} className={`h-7 cursor-pointer rounded-md px-2.5 transition-colors ${active === label ? "bg-card font-medium shadow-card" : "text-muted-foreground hover:text-foreground"}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="grid w-full grid-cols-[1fr_auto_1fr] items-center gap-1.5 text-xs text-muted-foreground sm:flex sm:w-auto">
        <Input type="date" aria-label="From" value={range.from} max={range.to || undefined} onChange={(e) => onChange({ ...range, from: e.target.value })} className="h-9 w-full sm:h-8 sm:w-[150px]" />
        <span aria-hidden>→</span>
        <Input type="date" aria-label="To" value={range.to} min={range.from || undefined} onChange={(e) => onChange({ ...range, to: e.target.value })} className="h-9 w-full sm:h-8 sm:w-[150px]" />
      </div>
    </div>
  );
}
