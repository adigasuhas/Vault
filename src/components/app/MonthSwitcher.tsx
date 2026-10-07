"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { monthLabel, shiftMonth } from "@/lib/dates";
import { localMonth } from "@/lib/client";
import { cn } from "@/lib/utils";

/** ‹ October 2026 › with a jump back to the current month. The label is a
 * native month input, so any month is one click away. */
export function MonthSwitcher({ month, onChange, className }: { month: string; onChange: (m: string) => void; className?: string }) {
  const current = localMonth();
  return (
    <div className={cn("inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1 shadow-card", className)}>
      <button
        type="button"
        aria-label="Previous month"
        onClick={() => onChange(shiftMonth(month, -1))}
        className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <label className="relative cursor-pointer">
        <span className="block min-w-[8.5rem] px-1 text-center text-sm font-medium tabular-nums">{monthLabel(month)}</span>
        <input
          type="month"
          value={month}
          aria-label="Choose month"
          onChange={(e) => e.target.value && onChange(e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
      <button
        type="button"
        aria-label="Next month"
        onClick={() => onChange(shiftMonth(month, 1))}
        className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
      {month !== current && (
        <button
          type="button"
          onClick={() => onChange(current)}
          className="ml-1 h-7 cursor-pointer rounded-md px-2 text-xs font-medium text-brass transition-colors hover:bg-brass-soft"
        >
          Today
        </button>
      )}
    </div>
  );
}
