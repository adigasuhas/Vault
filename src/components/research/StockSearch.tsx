"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { formatMoney } from "@/lib/currencies";
import type { SearchHit } from "@/lib/research/types";
import { cn } from "@/lib/utils";

/** Search listed companies by name or ticker; picking one opens its research
 * (through `onPick` when given, else on the Investments page). */
export function StockSearch({ autoFocus, className, onPick }: { autoFocus?: boolean; className?: string; onPick?: (h: SearchHit) => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) return;
    const id = ++seq.current;
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const r = await fetch(`/api/research/search?q=${encodeURIComponent(query)}`);
        const d = await r.json().catch(() => ({}));
        if (id !== seq.current) return;
        if (!r.ok) {
          setError(d.error || "Search isn't working right now.");
          setHits([]);
        } else {
          setError(null);
          setHits(d.hits ?? []);
          setActive(0);
        }
      } catch {
        if (id === seq.current) setError("Couldn't reach VAULT. Check your connection.");
      } finally {
        if (id === seq.current) setBusy(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const go = (h: SearchHit) => {
    try {
      const recent: SearchHit[] = JSON.parse(localStorage.getItem("vault.research.recent") ?? "[]");
      localStorage.setItem("vault.research.recent", JSON.stringify([h, ...recent.filter((x) => x.symbol !== h.symbol)].slice(0, 8)));
    } catch {}
    if (onPick) {
      setQ("");
      setHits(null);
      return onPick(h);
    }
    router.push(`/investments?research=${encodeURIComponent(h.symbol)}`);
  };
  const shown = q.trim().length >= 2 ? hits : null;

  return (
    <div className={cn("relative", className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          role="combobox"
          aria-expanded={open && !!shown}
          aria-controls="research-results"
          aria-label="Search companies by name or ticker"
          autoFocus={autoFocus}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (!shown?.length) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, shown.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              go(shown[active]);
            }
          }}
          placeholder="Search a company or ticker, e.g. Infosys, RELIANCE.NS, AAPL"
          className="h-12 w-full rounded-xl border border-border bg-card pr-11 pl-12 text-base shadow-card outline-none transition-colors placeholder:text-muted-foreground/80 focus:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring/40"
        />
        {busy && <Loader2 className="absolute top-1/2 right-4 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
      </div>
      {open && shown && (
        <div id="research-results" role="listbox" className="absolute inset-x-0 top-full z-30 mt-1.5 overflow-hidden rounded-xl border border-border bg-popover shadow-pop">
          {error ? (
            <p className="px-4 py-4 text-sm text-negative">{error}</p>
          ) : shown.length === 0 ? (
            <p className="px-4 py-4 text-sm text-muted-foreground">{busy ? "Searching…" : `No listed companies match "${q.trim()}".`}</p>
          ) : (
            <ul className="max-h-[min(420px,60dvh)] divide-y divide-border/70 overflow-y-auto">
              {shown.map((h, i) => (
                <li key={h.symbol} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => go(h)}
                    onMouseEnter={() => setActive(i)}
                    className={cn("flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left transition-colors", i === active ? "bg-muted/70" : "hover:bg-muted/40")}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{h.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{h.symbol} · {h.exchange}{h.type ? ` · ${h.type}` : ""}</span>
                    </span>
                    {h.price != null && h.currency ? (
                      <span className="shrink-0 text-right text-sm tabular-nums">
                        {formatMoney(h.price, h.currency)}
                        {h.changePct != null && <span className={cn("block text-xs", h.changePct > 0 ? "text-positive" : h.changePct < 0 ? "text-negative" : "text-muted-foreground")}>{h.changePct > 0 ? "+" : h.changePct < 0 ? "−" : ""}{Math.abs(h.changePct).toFixed(2)}%</span>}
                      </span>
                    ) : (
                      <span className="shrink-0 text-xs text-muted-foreground">No price</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
