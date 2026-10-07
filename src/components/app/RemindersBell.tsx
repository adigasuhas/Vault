"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, X } from "lucide-react";
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

function readDismissed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) || "[]"));
  } catch {
    return new Set();
  }
}

/** Bell with what needs attention. Dismissals are remembered on this device
 * (they're conveniences, not data); items reappear if their situation changes
 * because their ids encode the state (e.g. "near" vs "over" budget). */
export function RemindersBell({ className, align = "start" }: { className?: string; align?: "start" | "end" }) {
  const pathname = usePathname();
  const [items, setItems] = useState<Reminder[] | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    fetch("/api/reminders", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { reminders: [] }))
      .then((d) => setItems(d.reminders ?? []))
      .catch(() => setItems([]));
  }, []);
  useEffect(() => {
    setDismissed(readDismissed());
    load();
  }, [load, pathname]);

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
          aria-label={visible.length ? `${visible.length} reminders` : "Reminders"}
          title="Reminders"
          className={cn("relative flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground", className)}
        >
          <Bell className="h-4 w-4" strokeWidth={1.75} />
          {visible.length > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brass px-1 text-[9.5px] font-semibold text-white tabular-nums dark:text-[#141415]">
              {visible.length > 9 ? "9+" : visible.length}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} side="bottom" className="w-[340px] p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-sm font-semibold">Reminders</p>
          <Link href="/settings" onClick={() => setOpen(false)} className="text-xs text-muted-foreground hover:text-foreground">Settings</Link>
        </div>
        {items === null ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">Checking…</p>
        ) : visible.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">All quiet. Nothing needs you right now.</p>
        ) : (
          <ul className="max-h-[420px] divide-y divide-border overflow-y-auto">
            {visible.map((r) => (
              <li key={r.id} className="group flex gap-3 px-4 py-3 transition-colors hover:bg-muted/50">
                <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", TONE[r.tone])} />
                <Link href={r.href} onClick={() => setOpen(false)} className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{r.title}</p>
                  <p className="text-xs text-muted-foreground">{r.body}</p>
                </Link>
                <button onClick={() => dismiss(r.id)} aria-label="Dismiss" className="h-6 w-6 shrink-0 cursor-pointer rounded-md text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground focus:opacity-100">
                  <X className="mx-auto h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
