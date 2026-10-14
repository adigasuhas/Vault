"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, ListFilter } from "lucide-react";
import { EmptyState } from "@/components/app/PageHeader";
import { cn } from "@/lib/utils";

/** The page's active date and category filters, in words ("for Client A
 * between 15 Sep and 25 Sep 2026"), or null when nothing is filtered. */
export const FilterScope = createContext<string | null>(null);

/** An empty tab: "nothing matches the filters" while they're on, otherwise
 * the tab's own first-run message. */
export function EmptyOrFiltered({ noun, children }: { noun: string; children: React.ReactNode }) {
  const scope = useContext(FilterScope);
  if (!scope) return <>{children}</>;
  return (
    <EmptyState icon={<ListFilter className="h-5 w-5" />} title="Nothing matches these filters">
      No {noun} {scope}. Pick another period or category, or clear the filters to see everything.
    </EmptyState>
  );
}

export type SortDir = "asc" | "desc";

/** Client-side sorting for a table: click a header to sort, again to flip. */
export function useSort<T, G extends Record<string, (r: T) => number | string>>(rows: T[], getters: G, initial: NoInfer<keyof G & string>, initialDir: SortDir = "desc") {
  type K = keyof G & string;
  const [key, setKey] = useState<K>(initial);
  const [dir, setDir] = useState<SortDir>(initialDir);
  const sorted = useMemo(() => {
    const g = getters[key];
    return [...rows].sort((a, b) => {
      const x = g(a);
      const y = g(b);
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return dir === "asc" ? c : -c;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, key, dir]);
  const toggle = (k: K) => {
    if (k === key) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setKey(k);
      setDir(typeof getters[k](rows[0] as T) === "string" ? "asc" : "desc");
    }
  };
  return { sorted, key, dir, toggle };
}

export function SortTh<K extends string>({
  k,
  label,
  sort,
  align = "left",
  className,
}: {
  k: K;
  label: string;
  sort: { key: K; dir: SortDir; toggle: (k: K) => void };
  align?: "left" | "right";
  className?: string;
}) {
  const active = sort.key === k;
  const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={cn("px-3 py-2.5 font-medium", align === "right" && "text-right", className)}>
      <button
        onClick={() => sort.toggle(k)}
        className={cn("inline-flex cursor-pointer items-center gap-1 uppercase transition-colors hover:text-foreground", active && "text-foreground", align === "right" && "flex-row-reverse")}
      >
        {label}
        <Icon className={cn("h-3 w-3", !active && "opacity-40")} />
      </button>
    </th>
  );
}
