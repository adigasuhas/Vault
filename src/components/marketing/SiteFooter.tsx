import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { BUY_ME_A_COFFEE_URL, GITHUB_REPO_URL } from "@/lib/links";

/** Footer for the public pages (landing, pricing). */
export function SiteFooter() {
  return (
    <footer className="relative z-10 border-t border-border">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-x-8 gap-y-4 px-5 py-8 text-xs text-muted-foreground md:px-8">
        <Logo className="opacity-80" />
        <nav className="flex flex-wrap items-center gap-x-6 gap-y-2" aria-label="Footer">
          <Link href="/pricing" className="transition-colors hover:text-foreground">Pricing</Link>
          <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-foreground">GitHub</a>
          <a href={BUY_ME_A_COFFEE_URL} target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-foreground">Buy me a coffee</a>
        </nav>
        <p>Self-hosted. Export everything, any time.</p>
      </div>
    </footer>
  );
}
