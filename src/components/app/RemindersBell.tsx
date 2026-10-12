"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Target, TriangleAlert, X } from "lucide-react";
import { formatMoney } from "@/lib/currencies";
import { formatDateTime } from "@/lib/format";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { Reminder } from "@/lib/reminders";

const KEY = "vault_dismissed_reminders";
const TONE: Record<Reminder["tone"], string> = {
  warning: "bg-warning",
  negative: "bg-negative",
  info: "bg-info",
  positive: "bg-positive",
};

/** A price target or stop-loss that was reached (see lib/price-alerts). */
interface AlertEvent {
  id: string;
  kind: "TARGET" | "STOP_LOSS";
  ticker: string;
  stockHoldingId: string | null;
  scopeLabel: string | null;
  threshold: string;
  observedPrice: string;
  currency: string;
  priceAt: string;
  createdAt: string;
  readAt: string | null;
}

const when = (iso: string) => formatDateTime(iso);

function readDismissed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) || "[]"));
  } catch {
    return new Set();
  }
}

/** Bell with what needs attention: price alerts that fired (stored, with
 * read state and history) and reminders. Reminder dismissals are remembered
 * on this device (they're conveniences, not data); items reappear if their
 * situation changes because their ids encode the state. */
export function RemindersBell({ className, align = "start" }: { className?: string; align?: "start" | "end" }) {
  const pathname = usePathname();
  const [items, setItems] = useState<Reminder[] | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);

  const load = useCallback(() => {
    fetch("/api/reminders", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { reminders: [] }))
      .then((d) => setItems(d.reminders ?? []))
      .catch(() => setItems([]));
    fetch("/api/alerts", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((d) => setAlerts(d.events ?? []))
      .catch(() => {});
  }, []);
  useEffect(() => {
    setDismissed(readDismissed());
    load();
    // Alerts can fire from the scheduled price update while a page is open.
    const t = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [load, pathname]);

  const unread = alerts.filter((a) => !a.readAt).length;
  const patchAlert = (id: string, body: { read?: boolean; dismissed?: boolean }) => {
    setAlerts((all) => (body.dismissed ? all.filter((a) => a.id !== id) : all.map((a) => (a.id === id ? { ...a, readAt: body.read ? a.readAt ?? new Date().toISOString() : null } : a))));
    fetch(`/api/alerts/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => load());
  };
  const readAll = () => {
    setAlerts((all) => all.map((a) => ({ ...a, readAt: a.readAt ?? new Date().toISOString() })));
    fetch("/api/alerts/read-all", { method: "POST" }).catch(() => load());
  };

  const visible = (items ?? []).filter((r) => !dismissed.has(r.id));
  const dismiss = (id: string) => {
    const next = new Set(dismissed).add(id);
    setDismissed(next);
    try {
      localStorage.setItem(KEY, JSON.stringify([...next].slice(-300)));
    } catch {
      /* storage blocked */
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          aria-label={visible.length + unread ? `${visible.length + unread} notifications` : "Notifications"}
          title="Notifications"
          className={cn("relative flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground", className)}
        >
          <Bell className="h-4 w-4" strokeWidth={1.75} />
          {visible.length + unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brass px-1 text-[9.5px] font-semibold text-white tabular-nums dark:text-[#141415]">
              {visible.length + unread > 9 ? "9+" : visible.length + unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} side="bottom" className="w-[min(340px,calc(100vw-1.5rem))] p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-sm font-semibold">Notifications</p>
          <span className="flex items-center gap-3">
            {unread > 0 && <button onClick={readAll} className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">Mark all read</button>}
            <Link href="/settings#reminders" onClick={() => setOpen(false)} className="text-xs text-muted-foreground hover:text-foreground">Settings</Link>
          </span>
        </div>
        <div className="max-h-[min(520px,70dvh)] overflow-y-auto">
        {alerts.length > 0 && (
          <div>
            <p className="eyebrow px-4 pt-3 pb-1">Price alerts</p>
            <ul className="divide-y divide-border">
              {alerts.map((a) => {
                const target = a.kind === "TARGET";
                const Icon = target ? Target : TriangleAlert;
                return (
                  <li key={a.id} className={cn("group flex gap-3 px-4 py-3 transition-colors hover:bg-muted/50", !a.readAt && "bg-muted/30")}>
                    <span className={cn("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md", target ? "bg-positive/12 text-positive" : "bg-negative/12 text-negative")}>
                      <Icon className="h-3.5 w-3.5" strokeWidth={2} />
                    </span>
                    <Link
                      href={a.stockHoldingId ? `/investments?stock=${a.stockHoldingId}` : "/investments"}
                      onClick={() => {
                        if (!a.readAt) patchAlert(a.id, { read: true });
                        setOpen(false);
                      }}
                      className="min-w-0 flex-1"
                    >
                      <p className="flex items-center gap-1.5 text-sm font-medium">
                        {!a.readAt && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brass" aria-label="Unread" />}
                        <span className="truncate">{target ? `${a.ticker} reached your target` : `${a.ticker} hit your stop-loss`}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {a.scopeLabel && <span className="text-foreground/80">{a.scopeLabel} · </span>}
                        {formatMoney(Number(a.observedPrice), a.currency)} vs {target ? "target" : "stop-loss"} {formatMoney(Number(a.threshold), a.currency)}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {target ? "Price quoted" : "Review the position. Nothing was sold. Quoted"} {when(a.priceAt)}
                      </p>
                    </Link>
                    <button onClick={() => patchAlert(a.id, { dismissed: true })} aria-label="Dismiss" className="h-6 w-6 shrink-0 cursor-pointer rounded-md text-muted-foreground transition-opacity hover:text-foreground focus:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100">
                      <X className="mx-auto h-3.5 w-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
            {(items?.length ?? 0) > 0 && <p className="eyebrow border-t border-border px-4 pt-3 pb-1">Reminders</p>}
          </div>
        )}
        {items === null ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">Checking…</p>
        ) : visible.length === 0 ? (
          alerts.length ? null : <p className="px-4 py-8 text-center text-sm text-muted-foreground">All quiet. Nothing needs you right now.</p>
        ) : (
          <ul className="divide-y divide-border">
            {visible.map((r) => (
              <li key={r.id} className="group flex gap-3 px-4 py-3 transition-colors hover:bg-muted/50">
                <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", TONE[r.tone])} />
                <Link href={r.href} onClick={() => setOpen(false)} className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{r.title}</p>
                  <p className="text-xs text-muted-foreground">{r.body}</p>
                </Link>
                <button onClick={() => dismiss(r.id)} aria-label="Dismiss" className="h-6 w-6 shrink-0 cursor-pointer rounded-md text-muted-foreground transition-opacity hover:text-foreground focus:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100">
                  <X className="mx-auto h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
