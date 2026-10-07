import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/marketing/SiteHeader";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { CoffeeNote } from "@/components/marketing/CoffeeNote";
import { CurrencyZero } from "@/components/marketing/CurrencyZero";
import { GITHUB_REPO_URL, LICENSE_SUMMARY } from "@/lib/links";

export const metadata: Metadata = {
  title: "Pricing",
  description: "VAULT is free: every feature, for everyone, wherever you are. Download it from GitHub and run it on your own machine, or host it on Netlify, Vercel or any provider you like.",
};

/**
 * /pricing. VAULT has exactly one price, so there is exactly one card, no
 * invented tiers. The optional coffee sits beside it, styled so it can't be
 * mistaken for a plan. Three plain answers underneath, and that's the page.
 */
const INCLUDED = [
  "Accounts, cards and the ledger",
  "Budgets, expenses and one-offs",
  "Income, bills and loans",
  "Investments, analytics and reports",
  "Source on GitHub",
  "Run it on your own server",
];

const QUESTIONS = [
  { q: "Is it really free?", a: "Yes. There is no paid version, no trial and no usage limit. Every account gets everything." },
  { q: "Can I run my own copy?", a: "Yes. Download it from GitHub and run it on your laptop, a home server, or a host like Netlify, Vercel, Render or Railway. Your data stays wherever you put it." },
  { q: "So what’s the catch?", a: "There isn’t one. No ads, no tracking, nothing sold. It exists because I needed it." },
];

function GithubIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

export default function PricingPage() {
  return (
    <div className="grain relative flex min-h-dvh flex-col overflow-x-hidden bg-background text-foreground">
      <SiteHeader />
      <main id="main" className="relative z-10 flex-1">
        <section className="mx-auto max-w-[1200px] px-5 pb-10 pt-16 md:px-8 sm:pt-24">
          <p className="settle text-sm font-medium text-brass">Pricing</p>
          <h1 className="settle mt-3 text-[52px] font-semibold leading-[1.02] tracking-[-0.045em] sm:text-[76px]" style={{ ["--i" as string]: 1 }}>
            Free. Completely.
          </h1>
          <p className="settle mt-5 max-w-[48ch] text-[18px] leading-relaxed text-muted-foreground" style={{ ["--i" as string]: 2 }}>
            One price, in every currency, wherever you are. Run VAULT on your own machine, or host it on Netlify, Vercel or any provider you like.
          </p>
        </section>

        <section className="mx-auto max-w-[1200px] px-5 pb-20 md:px-8">
          <div className="settle grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,4fr)]" style={{ ["--i" as string]: 4 }}>
            <article className="flex flex-col rounded-[20px] border border-border bg-card p-6 shadow-pop sm:p-9">
              <div>
                <p className="text-[14px] font-medium text-muted-foreground">VAULT, everything included</p>
                <div className="mt-3 flex items-end gap-3">
                  <CurrencyZero className="text-[96px] font-semibold leading-[0.85] tracking-[-0.05em] tabular-nums" />
                  <p className="pb-2 text-[14px] leading-snug text-muted-foreground">per month,<br />forever</p>
                </div>
                <ul className="mt-8 grid gap-x-8 gap-y-3 border-t border-border pt-7 text-[15px] sm:grid-cols-2">
                  {INCLUDED.map((it) => (
                    <li key={it} className="flex items-start gap-2.5">
                      <svg viewBox="0 0 16 16" width="16" height="16" className="mt-[3px] shrink-0 text-brass" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 8.5l3 3 7-7" /></svg>
                      {it}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="mt-auto flex flex-wrap items-center gap-x-6 gap-y-4 pt-9">
                <Link
                  href="/signup"
                  className="inline-flex h-11 items-center justify-center rounded-[11px] bg-primary px-5 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring active:translate-y-px"
                >
                  Create a free account
                </Link>
                <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[15px] font-semibold underline-offset-[5px] hover:underline">
                  <GithubIcon className="h-4 w-4" /> Download from GitHub
                </a>
                <a href={`${GITHUB_REPO_URL}/blob/main/docs/DEPLOYMENT.md`} target="_blank" rel="noopener noreferrer" className="text-[14px] text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground">
                  Self-hosting guide
                </a>
              </div>
            </article>
            <CoffeeNote />
          </div>

          <dl className="mt-16 grid gap-x-12 gap-y-8 border-t border-border pt-10 md:grid-cols-3">
            {QUESTIONS.map((x) => (
              <div key={x.q}>
                <dt className="text-[16px] font-semibold tracking-[-0.01em]">{x.q}</dt>
                <dd className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{x.a}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-10 text-[13px] text-muted-foreground/80">{LICENSE_SUMMARY}</p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
