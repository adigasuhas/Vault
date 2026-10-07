"use client";

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "@/context/SessionContext";
import { FxTicker } from "@/components/app/FxTicker";
import { Logo } from "@/components/brand/Logo";
import { RemindersBell } from "@/components/app/RemindersBell";
import { cn } from "@/lib/utils";
import {
  LayoutGrid,
  Landmark,
  Receipt,
  PiggyBank,
  CalendarArrowDown,
  CalendarArrowUp,
  LineChart,
  ChartNoAxesColumn,
  Settings,
  ScrollText,
  Terminal,
  Menu,
  X,
  LogOut,
  Plus,
  PanelLeftClose,
  PanelLeftOpen,
  NotebookPen,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Item = { href: string; label: string; icon: typeof LayoutGrid; badgeKey?: "income" | "payment" };
const NAV: { heading: string | null; items: Item[] }[] = [
  { heading: null, items: [{ href: "/dashboard", label: "Overview", icon: LayoutGrid }] },
  {
    heading: "Money",
    items: [
      { href: "/accounts", label: "Accounts", icon: Landmark },
      { href: "/ledger", label: "Ledger", icon: ScrollText },
    ],
  },
  {
    heading: "Planning",
    items: [
      { href: "/budget", label: "Budget", icon: PiggyBank },
      { href: "/expenses", label: "Expenses", icon: Receipt },
      { href: "/notebook", label: "Notebook", icon: NotebookPen },
    ],
  },
  {
    heading: "Scheduled",
    items: [
      { href: "/receivables", label: "Receivables", icon: CalendarArrowDown, badgeKey: "income" },
      { href: "/payments", label: "Loans & payments", icon: CalendarArrowUp, badgeKey: "payment" },
    ],
  },
  {
    heading: "Wealth",
    items: [
      { href: "/investments", label: "Investments", icon: LineChart },
      { href: "/analytics", label: "Analytics", icon: ChartNoAxesColumn },
    ],
  },
];

const MOBILE_TABS: Item[] = [
  { href: "/dashboard", label: "Overview", icon: LayoutGrid },
  { href: "/budget", label: "Budget", icon: PiggyBank },
  { href: "/expenses", label: "Expenses", icon: Receipt },
  { href: "/accounts", label: "Accounts", icon: Landmark },
];

const PUBLIC_ROUTES = ["/", "/pricing", "/login", "/signup", "/forgot-password", "/reset-password"];
const CHROME_LESS_ROUTES = [...PUBLIC_ROUTES, "/onboarding"];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/") || (href === "/payments" && pathname.startsWith("/loans"));
}

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsedState] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pending, setPending] = useState<{ income: number; payment: number }>({ income: 0, payment: 0 });

  useEffect(() => {
    try {
      const stored = localStorage.getItem("vault_sidebar_collapsed");
      if (stored === "true" || stored === "false") setCollapsedState(stored === "true");
    } catch {
      /* storage blocked */
    }
  }, []);

  const setCollapsed = (value: boolean) => {
    setCollapsedState(value);
    try {
      localStorage.setItem("vault_sidebar_collapsed", String(value));
    } catch {
      /* ignore */
    }
  };

  const isChromeLess = CHROME_LESS_ROUTES.includes(pathname);
  const isPublic = PUBLIC_ROUTES.includes(pathname);

  useEffect(() => {
    if (loading || isPublic) return;
    if (!user) router.push("/login");
    else if (!user.isOnboarded && pathname !== "/onboarding") router.push("/onboarding");
  }, [user, loading, isPublic, pathname, router]);

  // Items waiting on the user (due receivables / payments) badge the nav.
  useEffect(() => {
    if (!user || isChromeLess) return;
    let cancelled = false;
    fetch("/api/occurrences?status=PENDING,FAILED", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        const occ = (d.occurrences ?? []) as { direction: string }[];
        setPending({ income: occ.filter((o) => o.direction === "INCOME").length, payment: occ.filter((o) => o.direction === "PAYMENT").length });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user, pathname, isChromeLess]);

  useEffect(() => setMobileOpen(false), [pathname]);

  if (isChromeLess) return <Suspense>{children}</Suspense>;

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Logo compact className="animate-pulse" />
      </div>
    );
  }

  const groups = NAV;

  const quickAdd = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Add a transaction"
          className="flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-transform hover:bg-primary/90 active:scale-95"
        >
          <Plus className="h-4 w-4" />
          New
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Add</DropdownMenuLabel>
        <DropdownMenuItem asChild><Link href="/expenses?new=1">Expense</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link href="/accounts?tab=transfers&new=1">Transfer</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link href="/receivables?income=1">Money received</Link></DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild><Link href="/receivables?new=1">Recurring income</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link href="/payments?new=1">Scheduled payment</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link href="/accounts?new=1">Account or card</Link></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="grain flex min-h-screen bg-background text-foreground">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >
        Skip to content
      </a>

      {mobileOpen && <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setMobileOpen(false)} />}

      <aside
        aria-label="Main navigation"
        className={cn(
          "fixed top-0 z-50 flex h-[100dvh] w-[248px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width,transform] duration-200 md:sticky",
          collapsed ? "md:w-[64px]" : "md:w-[224px]",
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}
      >
        <div className={cn("flex h-16 items-center gap-2 px-4", collapsed && "md:h-auto md:flex-col md:items-center md:justify-center md:gap-3 md:px-0 md:pt-4 md:pb-3")}>
          <Link href="/dashboard" aria-label="VAULT overview" className={cn("mr-auto", collapsed && "md:mx-auto")}>
            <Logo compact={collapsed} />
          </Link>
          <button
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand" : "Collapse"}
            className="hidden h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground md:flex"
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" strokeWidth={1.75} /> : <PanelLeftClose className="h-4 w-4" strokeWidth={1.75} />}
          </button>
          <button className="cursor-pointer rounded-lg p-1.5 text-muted-foreground hover:text-foreground md:hidden" onClick={() => setMobileOpen(false)} aria-label="Close menu">
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-4 pt-1">
          {groups.map((g, gi) => (
            <div key={gi} className={cn(gi > 0 && "mt-4")}>
              {g.heading && (
                <p className={cn("mb-1 px-2.5 text-[11px] font-medium text-muted-foreground/70", collapsed && "md:hidden")}>{g.heading}</p>
              )}
              {g.heading && collapsed && <div className="mx-auto mb-2 hidden h-px w-6 bg-sidebar-border md:block" />}
              <ul className="space-y-px">
                {g.items.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(pathname, item.href);
                  const count = item.badgeKey ? pending[item.badgeKey] : 0;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        title={collapsed ? item.label : undefined}
                        className={cn(
                          "group/nav relative flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] transition-colors",
                          active ? "bg-card font-medium text-foreground shadow-card" : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                          collapsed && "md:h-9 md:justify-center md:px-0"
                        )}
                      >
                        <Icon className={cn("h-4 w-4 shrink-0", active ? "text-brass" : "text-muted-foreground group-hover/nav:text-foreground")} strokeWidth={1.75} />
                        <span className={cn("truncate", collapsed && "md:hidden")}>{item.label}</span>
                        {count > 0 && (
                          <span
                            className={cn(
                              "ml-auto flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-warning-soft px-1 text-[10.5px] font-semibold tabular-nums text-warning",
                              collapsed && "md:absolute md:top-0 md:right-1 md:ml-0"
                            )}
                            aria-label={`${count} waiting`}
                          >
                            {count}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-sidebar-border p-2.5">
          <FxTicker className="mb-2 px-1.5 md:hidden" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className={cn("flex w-full cursor-pointer items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors hover:bg-sidebar-accent", collapsed && "md:justify-center")}>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-foreground text-[12px] font-semibold text-background">
                  {(user.name || user.email)[0]?.toUpperCase()}
                </span>
                <span className={cn("min-w-0 flex-1", collapsed && "md:hidden")}>
                  <span className="block truncate text-[13px] font-medium">{user.name || "You"}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{user.email}</span>
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-56">
              <DropdownMenuItem asChild><Link href="/settings"><Settings className="h-4 w-4" /> Settings</Link></DropdownMenuItem>
              {user.isDeveloper && <DropdownMenuItem asChild><Link href="/developer"><Terminal className="h-4 w-4" /> Developer</Link></DropdownMenuItem>}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout} variant="destructive"><LogOut className="h-4 w-4" /> Sign out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      <div className="relative z-[1] flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background/85 px-4 backdrop-blur-md md:hidden">
          <button onClick={() => setMobileOpen(true)} aria-label="Open menu" className="-ml-1 cursor-pointer rounded-md p-1.5 text-muted-foreground hover:text-foreground">
            <Menu className="h-5 w-5" />
          </button>
          <Link href="/dashboard" aria-label="VAULT overview"><Logo /></Link>
          <span className="flex items-center gap-1">
          <RemindersBell align="end" />
          <Link href="/expenses?new=1" aria-label="Log an expense" className="-mr-1 rounded-md p-1.5 text-muted-foreground hover:text-foreground">
            <Plus className="h-5 w-5" />
          </Link>
          </span>
        </header>

        <div className="sticky top-0 z-30 hidden h-14 items-center justify-end gap-2 border-b border-border/70 bg-background/80 px-8 backdrop-blur-md md:flex">
          <FxTicker className="mr-auto" />
          <RemindersBell align="end" />
          {quickAdd}
        </div>

        <main id="main-content" key={pathname} className="mx-auto w-full max-w-[1280px] flex-1 px-4 pt-6 pb-28 md:px-8 md:pt-8 md:pb-16">
          <Suspense>{children}</Suspense>
        </main>

        <nav aria-label="Quick navigation" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-background/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden">
          {MOBILE_TABS.map((t) => {
            const Icon = t.icon;
            const active = isActive(pathname, t.href);
            return (
              <Link key={t.href} href={t.href} className={cn("flex h-14 flex-col items-center justify-center gap-1 text-[10.5px]", active ? "text-foreground" : "text-muted-foreground")}>
                <Icon className="h-[18px] w-[18px]" strokeWidth={active ? 2 : 1.75} />
                {t.label}
              </Link>
            );
          })}
          <button onClick={() => setMobileOpen(true)} className="flex h-14 cursor-pointer flex-col items-center justify-center gap-1 text-[10.5px] text-muted-foreground">
            <Menu className="h-[18px] w-[18px]" strokeWidth={1.75} />
            More
            {pending.income + pending.payment > 0 && <span className="absolute top-2 ml-5 h-1.5 w-1.5 rounded-full bg-warning" />}
          </button>
        </nav>
      </div>
    </div>
  );
}
