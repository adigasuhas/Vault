"use client";

import Link from "next/link";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, CalendarClock, Plus, Receipt, Repeat, Wallet } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * Every way to record money, grouped by which way it moves. Each option opens
 * the existing form for that kind of transaction, so validation, accounts,
 * categories and the ledger rules are exactly what they were.
 *
 * A transfer between the user's own accounts is a debit on one account and a
 * credit on another, never income or spending, so it's offered from both
 * sides and opens the same transfer form (from → to).
 */
interface EntryOption {
  href: string;
  label: string;
  hint: string;
  icon: typeof Receipt;
}

const TRANSFER_IN: EntryOption = { href: "/accounts?tab=transfers&new=1", label: "Transfer between my accounts", hint: "Not counted as income", icon: ArrowLeftRight };
const TRANSFER_OUT: EntryOption = { ...TRANSFER_IN, hint: "Not counted as spending" };

export const CREDIT_OPTIONS: EntryOption[] = [
  { href: "/receivables?income=1", label: "Money received", hint: "A refund, gift or one-off payment", icon: Wallet },
  { href: "/receivables?new=1", label: "Recurring income", hint: "Salary, stipend: on a schedule", icon: Repeat },
  TRANSFER_IN,
];

export const DEBIT_OPTIONS: EntryOption[] = [
  { href: "/expenses?new=1", label: "Expense", hint: "Spending from an account or card", icon: Receipt },
  { href: "/payments?new=1", label: "Scheduled payment", hint: "Rent, EMI, subscriptions, bills", icon: CalendarClock },
  TRANSFER_OUT,
];

function Options({ options }: { options: EntryOption[] }) {
  return (
    <>
      {options.map((o) => {
        const Icon = o.icon;
        return (
          <DropdownMenuItem key={o.label} asChild className="items-start py-2">
            <Link href={o.href}>
              <Icon className="mt-0.5 h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
              <span className="min-w-0">
                <span className="block text-[13px]">{o.label}</span>
                <span className="block text-[11.5px] text-muted-foreground">{o.hint}</span>
              </span>
            </Link>
          </DropdownMenuItem>
        );
      })}
    </>
  );
}

const DIRECTIONS = {
  CREDIT: { label: "Credit", menuLabel: "Money in", icon: ArrowDownLeft, tone: "text-positive", options: CREDIT_OPTIONS },
  DEBIT: { label: "Debit", menuLabel: "Money out", icon: ArrowUpRight, tone: "text-negative", options: DEBIT_OPTIONS },
} as const;

/** The two primary actions, side by side as one control. */
export function TransactionEntry({ className, size = "sm" }: { className?: string; size?: "sm" | "md" }) {
  return (
    <div role="group" aria-label="Record a transaction" className={cn("inline-flex shrink-0 rounded-lg bg-primary p-0.5 text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]", className)}>
      {(["CREDIT", "DEBIT"] as const).map((d, i) => {
        const dir = DIRECTIONS[d];
        const Icon = dir.icon;
        return (
          <DropdownMenu key={d}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`${dir.label}: record ${dir.menuLabel.toLowerCase()}`}
                className={cn(
                  "flex cursor-pointer items-center gap-1.5 rounded-md font-medium transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] data-[state=open]:bg-white/15",
                  size === "md" ? "h-8 px-3 text-sm" : "h-7 px-2.5 text-[13px]",
                  i === 1 && "ml-0.5"
                )}
              >
                <Icon className="h-4 w-4" strokeWidth={2} />
                {dir.label}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Icon className={cn("h-3.5 w-3.5", dir.tone)} />
                {dir.menuLabel}
              </DropdownMenuLabel>
              <Options options={dir.options} />
            </DropdownMenuContent>
          </DropdownMenu>
        );
      })}
    </div>
  );
}

/** Phones: one + button with both directions in one short menu. */
export function TransactionEntryCompact({ className }: { className?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Record a transaction: credit or debit" className={cn("flex cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:text-foreground", className)}>
          <Plus className="h-5 w-5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {(["CREDIT", "DEBIT"] as const).map((d, i) => {
          const dir = DIRECTIONS[d];
          const Icon = dir.icon;
          return (
            <DropdownMenuGroup key={d}>
              {i > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Icon className={cn("h-3.5 w-3.5", dir.tone)} />
                {dir.label} · {dir.menuLabel.toLowerCase()}
              </DropdownMenuLabel>
              <Options options={dir.options.filter((o) => o !== TRANSFER_IN && o !== TRANSFER_OUT)} />
            </DropdownMenuGroup>
          );
        })}
        {/* On phones the transfer is listed once, on its own: it's both. */}
        <DropdownMenuSeparator />
        <Options options={[{ ...TRANSFER_OUT, hint: "Out of one, into another: not income or spending" }]} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
