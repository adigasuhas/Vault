"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "@/context/SessionContext";
import { useSignupOpen } from "@/lib/use-signup-open";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/#features", label: "Features" },
  { href: "/#ledger", label: "How it stays accurate" },
  { href: "/pricing", label: "Pricing" },
];

/** Top bar for the public pages (landing, pricing). */
export function SiteHeader() {
  const { user, loading } = useSession();
  const pathname = usePathname();
  const signedIn = !!user && !loading;
  const signupOpen = useSignupOpen() !== false;

  return (
    <header className="relative z-10 mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between px-5 md:px-8">
      <Link href="/" aria-label="VAULT home"><Logo /></Link>
      <nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            aria-current={pathname === l.href ? "page" : undefined}
            className={cn("transition-colors hover:text-foreground", pathname === l.href && "font-medium text-foreground")}
          >
            {l.label}
          </Link>
        ))}
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
  );
}
