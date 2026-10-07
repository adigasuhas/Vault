import { cn } from "@/lib/utils";

/** SVG coordinates rounded so server and browser render identical strings. */
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * VAULT identity.
 *
 * Mark: a vault door seen head-on — a squared door with softened corners, a
 * locking dial with eight graduations, and a brass hub. The dial (`.vault-dial`)
 * turns a quarter when its parent `.group` is hovered.
 *
 * Wordmark: hand-set geometric capitals on a 16-unit cap height with wide
 * tracking. The A has no ink crossbar; a short brass bar sits inside it
 * instead — the one note of colour, like the brass fittings on a safe.
 */

export function VaultMark({ className, title = "VAULT" }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("h-8 w-8", className)} role="img" aria-label={title} fill="none">
      <rect x="1.5" y="1.5" width="29" height="29" rx="7" className="fill-foreground" />
      <rect x="4.5" y="4.5" width="23" height="23" rx="4.5" className="stroke-background" strokeOpacity="0.22" strokeWidth="1" />
      <g className="vault-dial">
        <circle cx="16" cy="16" r="7.6" className="stroke-background" strokeWidth="1.6" />
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i * Math.PI) / 4;
          const r1 = 9.6;
          const rOuter = i % 2 === 0 ? 11.4 : 10.6;
          return (
            <line
              key={i}
              x1={r2(16 + r1 * Math.cos(a))}
              y1={r2(16 + r1 * Math.sin(a))}
              x2={r2(16 + rOuter * Math.cos(a))}
              y2={r2(16 + rOuter * Math.sin(a))}
              className="stroke-background"
              strokeOpacity={i % 2 === 0 ? 0.9 : 0.45}
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          );
        })}
        <path d="M16 10.4v2.4M21.6 16h-2.4M16 21.6v-2.4M10.4 16h2.4" className="stroke-background" strokeWidth="1.6" strokeLinecap="round" />
      </g>
      <circle cx="16" cy="16" r="2.4" fill="var(--brass)" />
    </svg>
  );
}

export function VaultWordmark({ className }: { className?: string }) {
  return (
    <svg viewBox="-1.5 -1.5 87 19" className={cn("h-3.5 w-auto", className)} role="img" aria-label="VAULT" fill="none">
      <g className="stroke-foreground" strokeWidth="2.4" strokeLinecap="square" strokeLinejoin="miter">
        <path d="M0 0 L6.2 16 L12.4 0" />
        <path d="M18 16 L24.2 0 L30.4 16" />
        <path d="M37 0 V9.6 a5.8 5.8 0 0 0 11.6 0 V0" />
        <path d="M56 0 V16 H65.6" />
        <path d="M71 0 H84 M77.5 0 V16" />
      </g>
      <path d="M21.4 10.6 H27" stroke="var(--brass)" strokeWidth="2.4" strokeLinecap="square" />
    </svg>
  );
}

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("group inline-flex items-center gap-2.5", className)}>
      <VaultMark className="h-7 w-7 shrink-0" />
      {!compact && <VaultWordmark className="h-3.5" />}
    </span>
  );
}
