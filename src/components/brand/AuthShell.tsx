import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, Check } from "lucide-react";
import { Logo, VaultMark } from "@/components/brand/Logo";

const POINTS = ["Every account and card in one place", "Budgets that know which month it is", "Nothing deleted, everything traceable"];

/** Two-panel frame for sign-in, sign-up, password reset and onboarding: a
 * quiet graphite brand panel (hidden on small screens) and the form on the
 * themed surface. */
export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grain grid min-h-[100dvh] bg-background text-foreground lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <aside className="group dark relative hidden overflow-hidden border-r border-white/[0.06] bg-[#141415] p-12 text-[#ecebe6] lg:block">
        {/* Oversized vault door, cropped into the bottom-left corner with
            nothing over it. Its dial turns once as the page loads and a
            quarter more on hover. */}
        <div className="auth-vault pointer-events-none absolute -bottom-48 -left-36 opacity-[0.16]" aria-hidden="true">
          <VaultMark className="h-[540px] w-[540px]" />
        </div>
        <div className="relative z-10 max-w-sm">
          <Link href="/" className="block w-fit" aria-label="VAULT home"><Logo /></Link>
          <p className="mt-14 text-[1.9rem] font-semibold leading-tight tracking-[-0.03em]">Your money, in order.</p>
          <ul className="mt-6 space-y-3 text-sm text-[#bdbab2]">
            {POINTS.map((p) => (
              <li key={p} className="flex items-center gap-2.5">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#c9a35a]/15 text-[#c9a35a]"><Check className="h-3 w-3" /></span>
                {p}
              </li>
            ))}
          </ul>
        </div>
      </aside>
      <main className="relative flex flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <Link href="/" className="lg:invisible" aria-label="VAULT home"><Logo /></Link>
          <Link
            href="/"
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs text-muted-foreground shadow-card transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Home
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="settle w-full max-w-[380px]">
            <h1 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.03em]">{title}</h1>
            {subtitle && <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>}
            <div className="mt-8">{children}</div>
            {footer && <div className="mt-8 border-t border-border pt-6 text-sm text-muted-foreground">{footer}</div>}
          </div>
        </div>
        <p className="text-center text-xs text-muted-foreground">Private by design. Your data stays in your own database.</p>
      </main>
    </div>
  );
}
