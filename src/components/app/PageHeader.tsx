import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Page title block: serif title, one line of context, actions on the right. */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("settle flex flex-wrap items-end justify-between gap-x-6 gap-y-4 pb-2", className)}>
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h1 className="font-display text-[1.65rem] leading-tight text-foreground md:text-[1.9rem]">{title}</h1>
        {description && <p className="mt-2 max-w-[62ch] text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** A titled section inside a page. */
export function Section({
  title,
  description,
  actions,
  children,
  className,
  id,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("settle scroll-mt-24 space-y-3", className)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[0.95rem] font-semibold tracking-[-0.01em] text-foreground">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** Surface panel — the standard container for content blocks. */
export function Panel({ children, className, padded = true }: { children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <div className={cn("rounded-xl border border-border bg-card text-card-foreground shadow-card", padded && "p-5", className)}>
      {children}
    </div>
  );
}

/** A labelled figure. */
export function Stat({
  label,
  value,
  hint,
  className,
  large = false,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  className?: string;
  large?: boolean;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="eyebrow">{label}</p>
      <div className={cn("mt-1.5 tabular-nums text-foreground", large ? "font-display text-[2rem] leading-none" : "text-xl font-semibold tracking-[-0.02em]")}>
        {value}
      </div>
      {hint && <div className="mt-1.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-start gap-3 rounded-xl border border-dashed border-border px-6 py-10 sm:items-center sm:text-center", className)}>
      {icon && <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">{icon}</div>}
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        {children && <div className="mt-1 max-w-[52ch] text-sm text-muted-foreground">{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cn("shimmer rounded-lg", className)} />;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-negative/30 bg-negative-soft px-4 py-3 text-sm">
      <span className="text-negative">{message}</span>
      {onRetry && (
        <button onClick={onRetry} className="cursor-pointer text-sm font-medium text-foreground underline underline-offset-4">
          Try again
        </button>
      )}
    </div>
  );
}
