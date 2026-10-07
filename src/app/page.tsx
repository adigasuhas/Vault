"use client";

import Link from "next/link";
import { useSession } from "@/context/SessionContext";
import { useSignupOpen } from "@/lib/use-signup-open";
import { Logo } from "@/components/brand/Logo";
import { Sparkline } from "@/components/app/Sparkline";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  Landmark,
  CreditCard,
  PiggyBank,
  Receipt,
  CalendarArrowDown,
  CalendarArrowUp,
  LineChart,
  ChartNoAxesColumn,
  CheckCircle2,
} from "lucide-react";

/** Deterministic price-like series for the showcase sparklines (no randomness,
 * so server and client render identically). */
function series(seed: number, drift: number) {
  return Array.from({ length: 48 }, (_, i) => ({
    d: `2026-${String(1 + Math.floor(i / 4)).padStart(2, "0")}-01`,
    v: Math.round((100 + drift * i + 6 * Math.sin(i / (2 + seed)) + 3 * Math.sin(i * seed)) * 100) / 100,
  }));
}

function Card({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-border bg-card p-4 shadow-card ${className}`}>
      <p className="text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">{title}</p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Showcase() {
  const spend = [
    ["Rent", 950],
    ["Groceries", 312],
    ["Transport", 118],
    ["Eating out", 96],
  ] as const;
  return (
    <div className="rounded-2xl border border-border bg-muted/60 p-2 shadow-pop">
      <div className="flex items-center gap-1.5 px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-border" />
        <span className="h-2.5 w-2.5 rounded-full bg-border" />
        <span className="h-2.5 w-2.5 rounded-full bg-border" />
        <span className="ml-3 text-[11px] text-muted-foreground">Overview · October</span>
      </div>
      <div className="grid gap-2 rounded-xl bg-background p-2 sm:grid-cols-2 lg:grid-cols-[1.15fr_1fr_1fr]">
        <Card title="Accounts">
          <ul className="space-y-2.5 text-sm">
            {[
              ["Current account", "£2,140.50", "≈ ₹2,74,000"],
              ["Savings (India)", "₹1,85,000", "≈ £1,445"],
              ["Travel card", "$420.00", "≈ £318"],
            ].map(([n, v, e]) => (
              <li key={n} className="flex items-baseline justify-between gap-3">
                <span className="text-muted-foreground">{n}</span>
                <span className="text-right tabular-nums">
                  {v}
                  <span className="block text-[11px] text-muted-foreground">{e}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Spent this month">
          <p className="text-xl font-semibold tracking-tight tabular-nums">£1,476</p>
          <ul className="mt-3 space-y-2">
            {spend.map(([n, v]) => (
              <li key={n}>
                <div className="mb-1 flex justify-between text-xs"><span>{n}</span><span className="tabular-nums text-muted-foreground">£{v}</span></div>
                <div className="h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-[var(--series-2)]" style={{ width: `${(v / 950) * 100}%` }} /></div>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Budget · October" className="sm:col-span-2 lg:col-span-1">
          <div className="flex items-baseline justify-between">
            <span className="text-xl font-semibold tracking-tight tabular-nums">£1,476</span>
            <span className="text-xs text-muted-foreground">of £2,100</span>
          </div>
          <div className="mt-2 h-2 rounded-full bg-muted"><div className="h-full w-[70%] rounded-full bg-foreground/70" /></div>
          <ul className="mt-4 space-y-1.5 text-xs">
            <li className="flex justify-between"><span>Rent (scheduled)</span><span className="text-positive">Paid</span></li>
            <li className="flex justify-between"><span>Groceries</span><span className="text-muted-foreground">£88 left</span></li>
            <li className="flex justify-between"><span>Eating out</span><span className="text-negative">£16 over</span></li>
          </ul>
        </Card>
        <Card title="Investments" className="sm:col-span-2">
          <ul className="divide-y divide-border">
            {(
              [
                ["Global equity ETF", "£8,412", "+12.4%", series(1.3, 0.35)],
                ["Index fund (India)", "₹96,300", "+8.1%", series(2.1, 0.22)],
                ["Tech stock", "$2,190", "−4.6%", series(0.7, -0.15)],
              ] as const
            ).map(([n, v, p, s]) => (
              <li key={n} className="flex items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{n}</span>
                <Sparkline points={[...s]} width={84} height={24} showChange={false} />
                <span className="w-20 text-right tabular-nums">{v}</span>
                <span className={`hidden w-14 text-right text-xs tabular-nums sm:block ${p.startsWith("+") ? "text-positive" : "text-negative"}`}>{p}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Coming up">
          <ul className="space-y-2.5 text-sm">
            {[
              ["1 Nov", "Salary", "+£3,250", "text-positive"],
              ["3 Nov", "Rent", "−£950", ""],
              ["5 Nov", "Loan EMI (India)", "−₹12,400", ""],
            ].map(([d, n, v, c]) => (
              <li key={n} className="flex items-center gap-3">
                <span className="w-11 text-[11px] text-muted-foreground tabular-nums">{d}</span>
                <span className="flex-1 truncate">{n}</span>
                <span className={`tabular-nums ${c}`}>{v}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

const FEATURES = [
  { icon: Landmark, title: "Bank accounts", body: "Add every account, see real balances, and move money between them in two clicks." },
  { icon: CreditCard, title: "Credit, prepaid and forex cards", body: "Track what you owe, what's left on the limit, and the travel card in another currency." },
  { icon: PiggyBank, title: "Budgets", body: "Plan each month by category and by card. Rent and bills drop into the right month on their own." },
  { icon: Receipt, title: "Expenses", body: "Log a spend in seconds, for any date. See what's left in that category before you hit save." },
  { icon: CalendarArrowDown, title: "Receivables", body: "Salary, stipends, refunds, pocket money. Set the schedule, confirm when it actually lands." },
  { icon: CalendarArrowUp, title: "Loans and scheduled payments", body: "EMIs, rent and subscriptions on autopilot. Skip one month without breaking the rest." },
  { icon: LineChart, title: "Investments", body: "Stocks and funds with every purchase, live value, profit and a one-year price line." },
  { icon: ChartNoAxesColumn, title: "Analytics and reports", body: "Where it goes, how much you keep, how long it lasts. Export to Excel, CSV or PDF." },
];

function LedgerDemo() {
  const rows = [
    { d: "06 Oct", t: "Transfer to savings", a: "−£500.00", note: "Original", muted: true, strike: true },
    { d: "06 Oct", t: "Reversal: sent by mistake", a: "+£500.00", note: "Reversal", muted: false, strike: false },
    { d: "07 Oct", t: "Groceries", a: "−£42.80", note: "", muted: false, strike: false },
  ];
  return (
    <div className="rounded-xl border border-border bg-card shadow-pop">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
        <p className="text-sm font-medium">Current account · statement</p>
        <span className="inline-flex items-center gap-1.5 text-xs text-positive"><CheckCircle2 className="h-3.5 w-3.5" /> Balance matches its history</span>
      </div>
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.t} className={`flex items-center gap-4 px-5 py-3 text-sm ${r.muted ? "bg-muted/40" : ""}`}>
            <span className="w-14 font-mono text-xs text-muted-foreground">{r.d}</span>
            <span className={`flex-1 ${r.strike ? "text-muted-foreground line-through" : ""}`}>{r.t}</span>
            {r.note && <span className="hidden rounded-[5px] border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground sm:inline">{r.note}</span>}
            <span className={`w-24 text-right tabular-nums ${r.a.startsWith("+") ? "text-positive" : ""}`}>{r.a}</span>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between border-t border-border px-5 py-3 text-sm">
        <span className="text-muted-foreground">Balance</span>
        <span className="font-semibold tabular-nums">£2,140.50</span>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const { user, loading } = useSession();
  const signedIn = !!user && !loading;
  const signupOpen = useSignupOpen() !== false;
  const startHref = signedIn ? "/dashboard" : signupOpen ? "/signup" : "/login";

  return (
    <div className="grain relative min-h-screen overflow-x-hidden bg-background text-foreground">
      <header className="relative z-10 mx-auto flex h-16 max-w-[1200px] items-center justify-between px-5 md:px-8">
        <Link href="/" aria-label="VAULT home"><Logo /></Link>
        <nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
          <a href="#features" className="transition-colors hover:text-foreground">Features</a>
          <a href="#ledger" className="transition-colors hover:text-foreground">How it stays accurate</a>
        </nav>
        <div className="flex items-center gap-2">
          {signedIn ? (
            <Button asChild><Link href="/dashboard">Open VAULT</Link></Button>
          ) : (
            <>
              <Button asChild variant="ghost"><Link href="/login">Sign in</Link></Button>
              {signupOpen && <Button asChild><Link href="/signup">Create account</Link></Button>}
            </>
          )}
        </div>
      </header>

      <main className="relative z-10">
        <section className="mx-auto max-w-[1200px] px-5 pt-16 pb-20 md:px-8 md:pt-24">
          <div className="settle mx-auto max-w-3xl text-center">
            <h1 className="text-[2.6rem] font-semibold leading-[1.05] tracking-[-0.04em] sm:text-[3.6rem]">Keep your money organised.</h1>
            <p className="mx-auto mt-5 max-w-[56ch] text-[1.05rem] leading-relaxed text-muted-foreground">
              Accounts, cards, budgets, bills and investments in one calm place. Every number adds up, and nothing quietly disappears.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg"><Link href={startHref}>{signedIn ? "Open VAULT" : signupOpen ? "Get started" : "Sign in"} <ArrowRight /></Link></Button>
              <Button asChild size="lg" variant="outline"><a href="#features">See what it does</a></Button>
            </div>
          </div>
          <div className="settle mx-auto mt-14 max-w-[1080px]" style={{ ["--i" as string]: 3 }}>
            <Showcase />
          </div>
        </section>

        <section id="features" className="scroll-mt-16 border-t border-border bg-card/50">
          <div className="mx-auto max-w-[1200px] px-5 py-20 md:px-8">
            <div className="max-w-2xl">
              <p className="text-sm font-medium text-brass">Features</p>
              <h2 className="mt-2 text-[2rem] font-semibold leading-tight tracking-[-0.03em]">Everything your money does, in one place.</h2>
            </div>
            <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURES.map((f) => {
                const Icon = f.icon;
                return (
                  <li key={f.title} className="lift group rounded-xl border border-border bg-background p-5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-foreground transition-colors group-hover:bg-brass-soft group-hover:text-brass">
                      <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
                    </span>
                    <h3 className="mt-4 font-semibold tracking-tight">{f.title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        <section id="ledger" className="mx-auto max-w-[1200px] scroll-mt-16 px-5 py-20 md:px-8">
          <div className="grid items-center gap-12 lg:grid-cols-[1fr_1.1fr]">
            <div>
              <p className="text-sm font-medium text-brass">Built on a ledger</p>
              <h2 className="mt-2 text-[2rem] font-semibold leading-tight tracking-[-0.03em]">Every change leaves a trail.</h2>
              <ul className="mt-6 space-y-4 text-sm">
                {[
                  ["Nothing is deleted", "Undo a transfer and you'll see the original and the reversal, side by side."],
                  ["Balances always add up", "Each balance is the sum of its history, and VAULT checks it."],
                  ["Real currencies", "A loan in rupees stays in rupees. You just see what it's worth in pounds."],
                ].map(([t, b]) => (
                  <li key={t} className="flex gap-3">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-positive" />
                    <span><span className="font-medium">{t}.</span> <span className="text-muted-foreground">{b}</span></span>
                  </li>
                ))}
              </ul>
            </div>
            <LedgerDemo />
          </div>
        </section>

        <section className="border-t border-border">
          <div className="mx-auto flex max-w-[1200px] flex-col items-start justify-between gap-6 px-5 py-14 md:flex-row md:items-center md:px-8">
            <div>
              <p className="text-xl font-semibold tracking-tight">Ready when you are.</p>
              <p className="mt-1 text-sm text-muted-foreground">Set up takes about a minute. Your data stays yours.</p>
            </div>
            <Button asChild size="lg"><Link href={startHref}>{signedIn ? "Open VAULT" : signupOpen ? "Create your account" : "Sign in"} <ArrowRight /></Link></Button>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-border">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-4 px-5 py-8 text-xs text-muted-foreground md:px-8">
          <Logo className="opacity-80" />
          <p>Self-hosted. Export everything, any time.</p>
        </div>
      </footer>
    </div>
  );
}
