import { cn } from "@/lib/utils";

const TONES = {
  neutral: "bg-muted text-muted-foreground",
  positive: "bg-positive-soft text-positive",
  negative: "bg-negative-soft text-negative",
  warning: "bg-warning-soft text-warning",
  info: "bg-info-soft text-info",
  brass: "bg-brass-soft text-brass",
  outline: "border border-border text-muted-foreground",
} as const;

export type Tone = keyof typeof TONES;

/** Square-cornered status tag with a leading dot. */
export function StatusBadge({ tone = "neutral", children, className, dot = true }: { tone?: Tone; children: React.ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex h-5 shrink-0 items-center gap-1.5 rounded-[5px] px-1.5 text-[11px] font-medium leading-none whitespace-nowrap", TONES[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />}
      {children}
    </span>
  );
}

/** Occurrence lifecycle → label + tone, worded per direction. */
export function occurrenceStatus(status: string, direction: "INCOME" | "PAYMENT"): { label: string; tone: Tone } {
  switch (status) {
    case "SCHEDULED":
      return { label: "Scheduled", tone: "outline" };
    case "PENDING":
      return { label: direction === "INCOME" ? "Awaiting confirmation" : "Due", tone: "warning" };
    case "CONFIRMED":
      return { label: direction === "INCOME" ? "Received" : "Paid", tone: "positive" };
    case "SKIPPED":
      return { label: "Skipped", tone: "neutral" };
    case "FAILED":
      return { label: "Failed", tone: "negative" };
    case "REVERSED":
      return { label: "Reversed", tone: "negative" };
    default:
      return { label: status, tone: "neutral" };
  }
}
