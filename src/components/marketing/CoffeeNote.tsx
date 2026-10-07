import { BUY_ME_A_COFFEE_URL, GITHUB_REPO_URL } from "@/lib/links";

/**
 * The optional "buy the developer a coffee" note, set beside the price so it
 * isn't missed, and written to be easy to ignore: no amounts, no goals, no
 * guilt, and it never unlocks anything. Deliberately not styled like a
 * plan: no price, no checklist, a dashed border and a quieter surface.
 */
export function CoffeeNote() {
  return (
    <aside aria-label="Support VAULT" className="flex h-full flex-col rounded-[20px] border border-dashed border-border bg-muted/50 p-6 sm:p-8">
      <EspressoMachine size={84} />
      <h2 className="mt-6 text-[18px] font-semibold tracking-[-0.01em]">VAULT is free. The coffee wasn&rsquo;t.</h2>
      <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
        It was built on a questionable amount of coffee and a frankly irresponsible number of AI tokens.
        If it saves you an afternoon, you can buy the next cup. If not, use it anyway. That was the point.
      </p>
      <div className="mt-auto pt-7">
        <a
          href={BUY_ME_A_COFFEE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-11 items-center justify-center rounded-[11px] border border-border bg-background px-5 text-[15px] font-semibold transition-colors hover:border-foreground/30 hover:bg-card focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring active:translate-y-px"
        >
          Buy me a coffee
          <span className="sr-only"> (opens buymeacoffee.com)</span>
        </a>
        <p className="mt-3 text-[13px] text-muted-foreground/80">
          Optional, and nothing unlocks. Not a coffee person?{" "}
          <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground">
            A star on GitHub
          </a>{" "}
          helps too.
        </p>
      </div>
    </aside>
  );
}

/**
 * A small espresso machine pulling a shot on a loop: the pump gauge ticks
 * up, two thin streams run, the cup fills, steam rises, repeat. CSS-only
 * (globals.css, `.espresso`), and frozen on a finished cup under reduced
 * motion. The shot is brass, VAULT's one accent.
 */
export function EspressoMachine({ size = 76 }: { size?: number }) {
  const sw = (1.5 * 48) / size;
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" className="espresso shrink-0 text-foreground" aria-hidden="true">
      {/* body */}
      <path d="M8 6.5h32a1.5 1.5 0 0 1 1.5 1.5v10H6.5V8A1.5 1.5 0 0 1 8 6.5z" />
      <path d="M6.5 18v22.5M11 18v22.5" />
      <path d="M5 41h38v2.5H5z" />
      <path d="M13.5 40.2h29" strokeWidth={sw * 0.7} strokeDasharray="1.4 1.6" opacity=".6" />
      {/* gauge + power light */}
      <circle cx="32" cy="12.2" r="3.2" />
      <path className="esp-needle" d="M32 12.2l-1.8-1.6" />
      <circle cx="13" cy="12.2" r="1.1" fill="var(--brass)" stroke="none" />
      {/* group head + portafilter */}
      <path d="M18.5 18v2.4h11V18M19.5 20.4h9l-.8 2.2h-7.4z" />
      <path d="M28.5 21.3h9.5" />
      {/* the shot */}
      <path className="esp-stream" d="M22.6 22.8V33M25.4 22.8V33" stroke="var(--brass)" strokeWidth={sw * 0.75} />
      {/* cup */}
      <path d="M18.5 31h11v5.5a3 3 0 0 1-3 3h-5a3 3 0 0 1-3-3z" />
      <path d="M29.5 32.4h1.2a1.8 1.8 0 0 1 0 3.6h-1.4" />
      <path className="esp-fill" d="M19.3 33.8h9.4v2.7a2.3 2.3 0 0 1-2.3 2.3h-4.8a2.3 2.3 0 0 1-2.3-2.3z" fill="var(--brass)" stroke="none" opacity=".85" />
      <path className="esp-steam" d="M22.4 25.2c-.8 1 .8 1.8 0 2.8M25.6 25.2c-.8 1 .8 1.8 0 2.8" strokeWidth={sw * 0.75} />
    </svg>
  );
}
