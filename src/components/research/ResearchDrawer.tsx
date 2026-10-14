"use client";

import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { StockSearch } from "@/components/research/StockSearch";
import { ResearchView, type ResearchActions } from "@/components/research/ResearchView";
import type { SearchHit } from "@/lib/research/types";

interface Held { id: string; ticker: string; quantity: string }

/**
 * Company research inside Investments: a panel over the portfolio, so the
 * holdings stay a click away. `symbol` null means closed, "" the search,
 * anything else that company. Looking never changes the portfolio; adding
 * goes through the usual purchase form.
 */
export function ResearchDrawer({
  symbol,
  onSymbol,
  held,
  onAdd,
  onOpenHolding,
}: {
  symbol: string | null;
  onSymbol: (s: string | null) => void;
  held: Held[];
} & Required<Pick<ResearchActions, "onAdd" | "onOpenHolding">>) {
  const [recent, setRecent] = useState<SearchHit[]>([]);
  useEffect(() => {
    if (symbol !== "") return;
    // Per device, read after mount so the server render matches.
    Promise.resolve().then(() => {
      try {
        setRecent(JSON.parse(localStorage.getItem("vault.research.recent") ?? "[]"));
      } catch {}
    });
  }, [symbol]);

  return (
    <Sheet open={symbol != null} onOpenChange={(o) => !o && onSymbol(null)}>
      <SheetContent side="right" className="gap-0 overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-3xl data-[side=right]:xl:max-w-4xl">
        <SheetHeader className="sticky top-0 z-20 gap-3 border-b border-border bg-popover/95 px-4 pt-4 pb-3 backdrop-blur sm:px-6">
          <div className="pr-10">
            <SheetTitle>Research</SheetTitle>
            <SheetDescription>Look up a listed company before you buy. Looking never changes your portfolio.</SheetDescription>
          </div>
          <StockSearch autoFocus={symbol === ""} onPick={(h) => onSymbol(h.symbol)} />
        </SheetHeader>
        <div className="px-4 py-5 sm:px-6">
          {symbol ? (
            <ResearchView key={symbol} symbol={symbol} onBack={() => onSymbol("")} onAdd={onAdd} onOpenHolding={onOpenHolding} />
          ) : (
            <div className="space-y-6">
              {held.length > 0 && (
                <section className="space-y-2">
                  <p className="eyebrow">Stocks you hold</p>
                  <ul className="flex flex-wrap gap-1.5">
                    {held.map((h) => (
                      <li key={h.id}>
                        <button type="button" onClick={() => onSymbol(h.ticker)} className="inline-flex h-8 cursor-pointer items-center rounded-full border border-border px-3 text-xs transition-colors hover:border-foreground/30">{h.ticker}</button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {recent.length > 0 && (
                <section className="space-y-2">
                  <p className="eyebrow">Recently looked at</p>
                  <ul className="divide-y divide-border/60">
                    {recent.map((r) => (
                      <li key={r.symbol}>
                        <button type="button" onClick={() => onSymbol(r.symbol)} className="flex w-full cursor-pointer items-center justify-between gap-3 py-2 text-left text-sm hover:underline">
                          <span className="min-w-0 truncate">{r.name}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{r.symbol} · {r.exchange}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {!held.length && !recent.length && <p className="text-sm text-muted-foreground">Search by company name or ticker. Indian stocks end in .NS (NSE) or .BO (BSE).</p>}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
