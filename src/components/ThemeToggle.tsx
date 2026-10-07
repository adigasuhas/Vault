"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

/** Light / Dark / System as a small segmented control; collapses to a
 * single cycling button in the narrow sidebar. */
export function ThemeToggle({ collapsed }: { collapsed?: boolean }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const current = mounted ? theme ?? "system" : "system";

  if (collapsed) {
    const i = OPTIONS.findIndex((o) => o.value === current);
    const next = OPTIONS[(i + 1) % OPTIONS.length];
    const Icon = OPTIONS[Math.max(i, 0)].icon;
    return (
      <button
        onClick={() => setTheme(next.value)}
        aria-label={`Theme: ${current}. Switch to ${next.label}`}
        title={`Theme: ${current}`}
        className="hidden h-9 w-full cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground md:flex"
      >
        <Icon className="h-[17px] w-[17px]" strokeWidth={1.75} />
      </button>
    );
  }

  return (
    <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-0.5 rounded-lg bg-sidebar-accent/70 p-0.5">
      {OPTIONS.map((o) => {
        const Icon = o.icon;
        const active = current === o.value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(o.value)}
            className={cn(
              "flex h-7 cursor-pointer items-center justify-center gap-1.5 rounded-md text-[11.5px] transition-colors",
              active ? "bg-card text-foreground shadow-card" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
