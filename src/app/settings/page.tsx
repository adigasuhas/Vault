"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Bell, Database, Monitor, Moon, Palette, Coins, ShieldCheck, Sun, UserRound } from "lucide-react";
import { useSession } from "@/context/SessionContext";
import { useCurrency } from "@/context/CurrencyContext";
import { api } from "@/lib/client";
import { SUPPORTED_CURRENCIES } from "@/lib/currencies";
import { SECURITY_QUESTIONS } from "@/lib/security-question-list";
import { PageHeader, Panel, SkeletonBlock, ErrorState } from "@/components/app/PageHeader";
import { FxTicker } from "@/components/app/FxTicker";
import { ConfirmAction } from "@/components/ConfirmAction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const TIMEZONES = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["UTC"];
const NONE = "__none__";

interface Settings {
  name: string | null;
  email: string;
  timezone: string;
  baseCurrency: string;
  secondaryCurrency: string | null;
  budgetCurrency: string;
  exchangeRateMode: "AUTOMATIC" | "MANUAL";
  notifyUpcomingCredits: boolean;
  notifyUpcomingBills: boolean;
  budgetAlertThreshold: number;
}
interface Rate { targetCurrency: string; rate: number | null; mode: string | null; fetchedAt: string | null }

const SECTIONS = [
  { id: "profile", label: "Profile", icon: UserRound },
  { id: "money", label: "Money", icon: Coins },
  { id: "reminders", label: "Reminders", icon: Bell },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "security", label: "Sign-in & security", icon: ShieldCheck },
  { id: "data", label: "Your data", icon: Database },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

/** One titled group of settings. */
function Section({ id, title, description, children }: { id: SectionId; title: string; description: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 space-y-3">
      <div>
        <h2 id={`${id}-title`} className="font-display text-xl text-foreground">{title}</h2>
        <p className="mt-0.5 max-w-prose text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

/** A setting: what it is and what it does on the left, the control on the right. */
function Row({ label, hint, htmlFor, children, stack = false }: { label: React.ReactNode; hint?: React.ReactNode; htmlFor?: string; children: React.ReactNode; stack?: boolean }) {
  return (
    <div className={cn("grid gap-3 px-5 py-4", stack ? "" : "sm:grid-cols-[minmax(0,1fr)_minmax(0,300px)] sm:items-center sm:gap-6")}>
      <div className="min-w-0">
        {htmlFor ? <Label htmlFor={htmlFor} className="text-sm font-medium">{label}</Label> : <p className="text-sm font-medium">{label}</p>}
        {hint && <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{hint}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function CurrencySelect({ id, value, onChange, allowNone }: { id?: string; value: string | null; onChange: (v: string | null) => void; allowNone?: boolean }) {
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        {allowNone && <SelectItem value={NONE}>None</SelectItem>}
        {SUPPORTED_CURRENCIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.code} · {c.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

// Fixed swatches from the light and dark tokens, so each preview shows its
// own palette whatever the current theme is.
const SWATCH = {
  light: { bg: "#f5f3ee", card: "#fdfcf9", ink: "#16171a", muted: "#696760", line: "#dfdbd1", brass: "#9c7a2e", up: "#2f7a4f" },
  dark: { bg: "#111111", card: "#18181a", ink: "#ecebe6", muted: "#9d9a92", line: "#2a2a2d", brass: "#c9a35a", up: "#6cbf8e" },
};

/** A tiny statement drawn in one palette. */
function MiniStatement({ tone }: { tone: keyof typeof SWATCH }) {
  const c = SWATCH[tone];
  return (
    <div className="h-full w-full p-2.5" style={{ background: c.bg }}>
      <div className="h-full rounded-md p-2" style={{ background: c.card, boxShadow: `0 0 0 1px ${c.line}` }}>
        <div className="h-1 w-8 rounded-full" style={{ background: c.brass }} />
        <div className="mt-1.5 h-2 w-14 rounded-sm" style={{ background: c.ink }} />
        {[0.9, 0.6, 0.75].map((w, i) => (
          <div key={i} className="mt-1.5 flex items-center justify-between gap-2">
            <div className="h-1 rounded-full" style={{ width: `${w * 60}%`, background: c.muted, opacity: 0.55 }} />
            <div className="h-1 w-5 rounded-full" style={{ background: i === 1 ? c.up : c.ink, opacity: 0.8 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function ThemePicker() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const current = mounted ? (theme ?? "system") : "system";
  const options = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "Match device", icon: Monitor },
  ] as const;
  return (
    <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-3">
      {options.map((o) => {
        const active = current === o.value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => {
              setTheme(o.value);
              toast.success(`${o.label === "Match device" ? "Following your device's theme" : `${o.label} theme on`}.`);
            }}
            className={cn(
              "group cursor-pointer overflow-hidden rounded-xl border text-left transition-[border-color,box-shadow,transform] duration-200 active:translate-y-px",
              active ? "border-brass shadow-[0_0_0_3px_var(--brass-soft)]" : "border-border hover:border-foreground/25"
            )}
          >
            <div className="relative aspect-[4/3] w-full">
              {o.value === "system" ? (
                <div className="grid h-full grid-cols-2">
                  <MiniStatement tone="light" />
                  <MiniStatement tone="dark" />
                </div>
              ) : (
                <MiniStatement tone={o.value} />
              )}
            </div>
            <div className="flex items-center gap-1.5 border-t border-border bg-card px-3 py-2 text-xs">
              <Icon className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.75} />
              <span className={cn(active && "font-medium")}>{o.label}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/** The time it is now in a time zone, for the zone picker's hint. */
function nowIn(tz: string) {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit" }).format(new Date());
  } catch {
    return null;
  }
}

export default function SettingsPage() {
  const { refreshSession, user } = useSession();
  const fx = useCurrency();
  const router = useRouter();
  const [s, setS] = useState<Settings | null>(null);
  const [saved, setSaved] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rates, setRates] = useState<Rate[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [confirmBudget, setConfirmBudget] = useState(false);
  const [pw, setPw] = useState({ current: "", next: "" });
  const [pwBusy, setPwBusy] = useState(false);
  const [em, setEm] = useState({ next: "", password: "" });
  const [emOpen, setEmOpen] = useState(false);
  const [emBusy, setEmBusy] = useState(false);
  const [deletePw, setDeletePw] = useState("");
  const [sq, setSq] = useState<{ current: string | null; question: string; answer: string; password: string }>({ current: null, question: "", answer: "", password: "" });
  const [sqBusy, setSqBusy] = useState(false);
  const [active, setActive] = useState<SectionId>("profile");

  const load = useCallback(async () => {
    try {
      const [d, r, q] = await Promise.all([
        api<Settings>("/api/settings"),
        api<{ rates: Rate[] }>("/api/exchange-rates"),
        api<{ question: string | null; questionText: string | null }>("/api/auth/security-question"),
      ]);
      setS(d);
      setSaved(d);
      setRates(r.rates);
      setSq((v) => ({ ...v, current: q.questionText, question: v.question || q.question || "" }));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  // Highlight the section in view in the index.
  useEffect(() => {
    if (!s) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id as SectionId);
      },
      { rootMargin: "-96px 0px -60% 0px" }
    );
    for (const x of SECTIONS) {
      const el = document.getElementById(x.id);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, [s]);

  if (error && !s) return <div className="max-w-5xl space-y-6"><PageHeader title="Settings" /><ErrorState message={error} onRetry={load} /></div>;
  if (!s || !saved) return <div className="max-w-5xl space-y-4"><SkeletonBlock className="h-12 w-60" /><SkeletonBlock className="h-72" /><SkeletonBlock className="h-72" /></div>;

  const dirty = JSON.stringify(s) !== JSON.stringify(saved);
  const set = (patch: Partial<Settings>) => setS({ ...s, ...patch });
  const changed = (k: keyof Settings) => JSON.stringify(s[k]) !== JSON.stringify(saved[k]);
  const sectionDirty: Partial<Record<SectionId, boolean>> = {
    profile: changed("name") || changed("timezone"),
    money: changed("baseCurrency") || changed("secondaryCurrency") || changed("budgetCurrency") || changed("exchangeRateMode"),
    reminders: changed("notifyUpcomingCredits") || changed("notifyUpcomingBills") || changed("budgetAlertThreshold"),
  };
  const thresholdOk = Number.isInteger(Number(s.budgetAlertThreshold)) && s.budgetAlertThreshold >= 1 && s.budgetAlertThreshold <= 100;

  async function save() {
    setSaving(true);
    try {
      await api("/api/settings", {
        body: {
          name: s!.name ?? "",
          timezone: s!.timezone,
          baseCurrency: s!.baseCurrency,
          secondaryCurrency: s!.secondaryCurrency,
          // Only when it changed: saving it re-plans every month's budget.
          ...(changed("budgetCurrency") ? { budgetCurrency: s!.budgetCurrency } : {}),
          exchangeRateMode: s!.exchangeRateMode,
          notifyUpcomingCredits: s!.notifyUpcomingCredits,
          notifyUpcomingBills: s!.notifyUpcomingBills,
          budgetAlertThreshold: Number(s!.budgetAlertThreshold),
        },
      });
      toast.success(changed("budgetCurrency") ? `Saved. Every month's budget is now planned in ${s!.budgetCurrency}.` : "Settings saved.");
      await Promise.all([load(), refreshSession()]);
      fx.reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  const requestSave = () => (changed("budgetCurrency") ? setConfirmBudget(true) : save());

  async function saveRate(target: string) {
    try {
      await api("/api/exchange-rates", { body: { targetCurrency: target, rate: drafts[target] } });
      toast.success(`Rate for ${target} saved.`);
      setDrafts((d) => ({ ...d, [target]: "" }));
      load();
      fx.reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwBusy(true);
    try {
      await api("/api/auth/change-password", { body: { currentPassword: pw.current, newPassword: pw.next } });
      setPw({ current: "", next: "" });
      toast.success("Password changed. You've been signed out everywhere else.");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPwBusy(false);
    }
  }

  async function changeEmail(e: React.FormEvent) {
    e.preventDefault();
    setEmBusy(true);
    try {
      const r = await api<{ email: string }>("/api/auth/change-email", { body: { newEmail: em.next, currentPassword: em.password } });
      setEm({ next: "", password: "" });
      setEmOpen(false);
      toast.success(`Your email is now ${r.email}. Use it to sign in. You've been signed out everywhere else.`);
      await Promise.all([load(), refreshSession()]);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setEmBusy(false);
    }
  }

  async function saveQuestion(e: React.FormEvent) {
    e.preventDefault();
    setSqBusy(true);
    try {
      await api("/api/auth/security-question", { body: { question: sq.question, answer: sq.answer, currentPassword: sq.password } });
      toast.success("Secret question saved. You can now reset your password with it.");
      setSq((v) => ({ ...v, answer: "", password: "" }));
      load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSqBusy(false);
    }
  }

  async function signOutOthers() {
    try {
      await api("/api/auth/sign-out-others", { body: {} });
      toast.success("Signed out of every other device. This one stays signed in.");
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function deleteAccount() {
    try {
      await api("/api/account", { method: "DELETE", body: { confirm: "DELETE", password: deletePw } });
      toast.success("Your account and data have been deleted.");
      await refreshSession();
      router.push("/");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const relevant = rates.filter((r) => [s.secondaryCurrency, ...SUPPORTED_CURRENCIES.map((c) => c.code)].includes(r.targetCurrency));
  const tzNow = nowIn(s.timezone);
  const lastLogin = (user as { lastLogin?: string | null } | null)?.lastLogin;

  return (
    <div className="max-w-5xl">
      <PageHeader title="Settings" description="Your profile, how money is shown, reminders, and how you sign in." />

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-8 pb-28 md:grid-cols-[188px_minmax(0,1fr)]">
        {/* Section index: a sticky list on wide screens, a scrolling strip on phones. */}
        <nav aria-label="Settings sections" className="sticky top-14 z-20 -mx-4 min-w-0 border-b border-border bg-background/90 px-4 py-2 backdrop-blur-md md:top-20 md:mx-0 md:self-start md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
          <ul className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
            {SECTIONS.map((x) => {
              const Icon = x.icon;
              const on = active === x.id;
              return (
                <li key={x.id} className="shrink-0">
                  <a
                    href={`#${x.id}`}
                    aria-current={on ? "true" : undefined}
                    onClick={() => setActive(x.id)}
                    className={cn(
                      "relative flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm whitespace-nowrap transition-colors",
                      on ? "bg-card font-medium text-foreground shadow-card" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Icon className={cn("h-4 w-4", on ? "text-brass" : "")} strokeWidth={1.75} />
                    {x.label}
                    {sectionDirty[x.id] && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-brass" aria-label="Unsaved changes" />}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="min-w-0 space-y-10">
          <Section id="profile" title="Profile" description="Who you are in Vault, and the clock your days and months follow.">
            <Panel padded={false} className="divide-y divide-border">
              <Row label="Name" hint="Shown in the sidebar and on reports." htmlFor="st-name">
                <Input id="st-name" value={s.name ?? ""} onChange={(e) => set({ name: e.target.value })} placeholder="Your name" />
              </Row>
              <Row label="Email" hint="The address you sign in with.">
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-sm">{s.email}</span>
                  <Button size="sm" variant="outline" onClick={() => { setEmOpen(true); document.getElementById("security")?.scrollIntoView({ behavior: "smooth" }); }}>Change</Button>
                </div>
              </Row>
              <Row label="Time zone" hint={<>Decides when your day, and your month, begins.{tzNow ? <> It&apos;s {tzNow} there now.</> : null}</>}>
                <Select value={s.timezone} onValueChange={(v) => set({ timezone: v })}>
                  <SelectTrigger className="w-full" aria-label="Time zone"><SelectValue /></SelectTrigger>
                  <SelectContent>{[...new Set([s.timezone, "UTC", ...TIMEZONES])].map((tz) => <SelectItem key={tz} value={tz}>{tz}</SelectItem>)}</SelectContent>
                </Select>
              </Row>
            </Panel>
          </Section>

          <Section id="money" title="Money" description="Every account, card and loan keeps its own currency. These choose how totals and conversions are shown, and which currency budgets are planned in.">
            <Panel padded={false} className="divide-y divide-border">
              <Row label="Primary currency" hint="Totals and net worth add up in this.">
                <CurrencySelect value={s.baseCurrency} onChange={(v) => v && set({ baseCurrency: v, secondaryCurrency: s.secondaryCurrency === v ? saved.baseCurrency : s.secondaryCurrency })} />
              </Row>
              <Row label="Second currency" hint={<>Shown as ≈ next to amounts. <FxTicker compact className="mt-1 flex" /></>}>
                <CurrencySelect allowNone value={s.secondaryCurrency} onChange={(v) => set({ secondaryCurrency: v === s.baseCurrency ? null : v })} />
              </Row>
              <Row
                label="Budget currency"
                hint={changed("budgetCurrency") ? <span className="text-warning">Saving converts every month&apos;s budget to {s.budgetCurrency} at today&apos;s rate. Your spending isn&apos;t touched.</span> : "Every month's budget is planned in this."}
              >
                <CurrencySelect value={s.budgetCurrency} onChange={(v) => v && set({ budgetCurrency: v })} />
              </Row>
              <Row
                label="Exchange rates"
                hint={
                  s.exchangeRateMode === "AUTOMATIC"
                    ? <>Market rates, updated automatically{fx.asOf ? <> (last {new Date(fx.asOf).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })})</> : null}.</>
                    : "You set each rate yourself below."
                }
              >
                <div role="radiogroup" aria-label="Rate source" className="inline-flex w-full rounded-lg bg-muted p-0.5 text-sm">
                  {(["AUTOMATIC", "MANUAL"] as const).map((m) => (
                    <button key={m} type="button" role="radio" aria-checked={s.exchangeRateMode === m} onClick={() => set({ exchangeRateMode: m })} className={cn("h-8 flex-1 cursor-pointer rounded-md transition-colors", s.exchangeRateMode === m ? "bg-card font-medium shadow-card" : "text-muted-foreground hover:text-foreground")}>
                      {m === "AUTOMATIC" ? "Automatic" : "Set my own"}
                    </button>
                  ))}
                </div>
              </Row>
              {relevant.length > 0 && (
                <div className="px-5 py-3">
                  <table className="w-full text-sm">
                    <caption className="sr-only">Exchange rates from {saved.baseCurrency}</caption>
                    <tbody className="divide-y divide-border/60">
                      {relevant.map((r) => (
                        <tr key={r.targetCurrency}>
                          <td className="py-2 text-muted-foreground">1 {saved.baseCurrency}</td>
                          <td className="py-2 tabular-nums">
                            {r.rate ? `${r.rate.toFixed(4)} ${r.targetCurrency}` : <span className="text-muted-foreground">No rate yet</span>}
                            {r.mode === "MANUAL" && <span className="ml-2 text-[11px] text-muted-foreground">set by you</span>}
                          </td>
                          <td className="py-2 text-right">
                            {s.exchangeRateMode === "MANUAL" && saved.exchangeRateMode === "MANUAL" ? (
                              <span className="inline-flex gap-2">
                                <Input type="number" step="0.0001" min="0" aria-label={`${r.targetCurrency} per ${saved.baseCurrency}`} placeholder={r.targetCurrency} value={drafts[r.targetCurrency] ?? ""} onChange={(e) => setDrafts((d) => ({ ...d, [r.targetCurrency]: e.target.value }))} className="h-8 w-28" />
                                <Button size="sm" variant="outline" disabled={!(Number(drafts[r.targetCurrency]) > 0)} onClick={() => saveRate(r.targetCurrency)}>Set</Button>
                              </span>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {s.exchangeRateMode === "MANUAL" && saved.exchangeRateMode !== "MANUAL" && <p className="pt-2 text-xs text-muted-foreground">Save to switch to your own rates; then you can set each one here.</p>}
                </div>
              )}
            </Panel>
          </Section>

          <Section id="reminders" title="Reminders" description="What shows up under the bell at the top of every page.">
            <Panel padded={false} className="divide-y divide-border">
              <Row label="Income about to arrive" hint="Scheduled income due in the next few days." htmlFor="st-credits">
                <div className="flex justify-end"><Switch id="st-credits" checked={s.notifyUpcomingCredits} onCheckedChange={(v) => set({ notifyUpcomingCredits: v })} /></div>
              </Row>
              <Row label="Bills coming up" hint="Scheduled payments and EMIs due in the next few days." htmlFor="st-bills">
                <div className="flex justify-end"><Switch id="st-bills" checked={s.notifyUpcomingBills} onCheckedChange={(v) => set({ notifyUpcomingBills: v })} /></div>
              </Row>
              <Row label="Budget warning" hint={thresholdOk ? `Flag a category once it has used ${s.budgetAlertThreshold}% of its budget.` : <span className="text-negative">Use a whole number from 1 to 100.</span>} htmlFor="st-threshold">
                <div className="flex items-center justify-end gap-2">
                  <Input id="st-threshold" type="number" inputMode="numeric" min="1" max="100" value={s.budgetAlertThreshold} aria-invalid={!thresholdOk} onChange={(e) => set({ budgetAlertThreshold: Number(e.target.value) })} className="w-20 text-right tabular-nums" />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
              </Row>
            </Panel>
          </Section>

          <Section id="appearance" title="Appearance" description="Applies on this device straight away.">
            <Panel>
              <ThemePicker />
            </Panel>
          </Section>

          <Section id="security" title="Sign-in & security" description="How you sign in, and how you'd get back in if you forgot your password.">
            <Panel padded={false} className="divide-y divide-border">
              <Row stack label="Email" hint={<>You sign in as <span className="text-foreground">{s.email}</span>. Changing it signs you out on every other device.</>}>
                {emOpen ? (
                  <form onSubmit={changeEmail} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                    <div className="space-y-1.5"><Label htmlFor="em-n">New email</Label><Input id="em-n" type="email" autoComplete="email" autoFocus value={em.next} onChange={(e) => setEm({ ...em, next: e.target.value })} required /></div>
                    <div className="space-y-1.5"><Label htmlFor="em-p">Current password</Label><PasswordInput id="em-p" autoComplete="current-password" value={em.password} onChange={(e) => setEm({ ...em, password: e.target.value })} required /></div>
                    <div className="flex gap-2">
                      <Button type="button" variant="ghost" onClick={() => { setEmOpen(false); setEm({ next: "", password: "" }); }}>Cancel</Button>
                      <Button type="submit" disabled={emBusy || !/^\S+@\S+\.\S+$/.test(em.next) || !em.password}>{emBusy ? "Updating…" : "Update email"}</Button>
                    </div>
                  </form>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => setEmOpen(true)}>Change email</Button>
                )}
              </Row>
              <Row stack label="Password" hint="At least 10 characters. Changing it signs you out on every other device.">
                <form onSubmit={changePassword} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                  <div className="space-y-1.5"><Label htmlFor="pw-c">Current password</Label><PasswordInput id="pw-c" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pw-n">New password</Label>
                    <PasswordInput id="pw-n" autoComplete="new-password" minLength={10} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required />
                  </div>
                  <Button type="submit" variant="outline" disabled={pwBusy || pw.next.length < 10 || !pw.current}>{pwBusy ? "Updating…" : "Update password"}</Button>
                </form>
                {pw.next.length > 0 && pw.next.length < 10 && <p className="mt-1.5 text-xs text-muted-foreground">{10 - pw.next.length} more {10 - pw.next.length === 1 ? "character" : "characters"} to go.</p>}
              </Row>
              <Row stack label="Secret question" hint="Answering it lets you set a new password if you forget yours. Answers are stored scrambled; capitals, spaces and punctuation don't matter.">
                {sq.current ? (
                  <p className="mb-3 text-sm">Current question: <span className="font-medium">{sq.current}</span></p>
                ) : (
                  <p className="mb-3 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">Not set yet, so you couldn&apos;t get back in if you forgot your password.</p>
                )}
                <form onSubmit={saveQuestion} className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="sq-q">Question</Label>
                    <Select value={sq.question} onValueChange={(v) => setSq({ ...sq, question: v })}>
                      <SelectTrigger id="sq-q" className="w-full"><SelectValue placeholder="Choose a question" /></SelectTrigger>
                      <SelectContent>{SECURITY_QUESTIONS.map((q) => <SelectItem key={q.id} value={q.id}>{q.text}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5"><Label htmlFor="sq-a">Answer</Label><Input id="sq-a" autoComplete="off" value={sq.answer} onChange={(e) => setSq({ ...sq, answer: e.target.value })} /></div>
                  <div className="space-y-1.5"><Label htmlFor="sq-p">Current password</Label><PasswordInput id="sq-p" autoComplete="current-password" value={sq.password} onChange={(e) => setSq({ ...sq, password: e.target.value })} /></div>
                  <div className="sm:col-span-2"><Button type="submit" variant="outline" disabled={sqBusy || !sq.question || sq.answer.trim().length < 2 || !sq.password}>{sqBusy ? "Saving…" : sq.current ? "Change question" : "Save question"}</Button></div>
                </form>
              </Row>
              <Row label="Other devices" hint={<>Signed in somewhere you shouldn&apos;t be, or on a shared computer? This device stays signed in.{lastLogin ? <> Last sign-in {new Date(lastLogin).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.</> : null}</>}>
                <div className="flex justify-end">
                  <ConfirmAction
                    title="Sign out of every other device?"
                    destructive={false}
                    description={<p>Anywhere else you&apos;re signed in will need your password again. You stay signed in here.</p>}
                    confirmLabel="Sign out others"
                    onConfirm={signOutOthers}
                    trigger={<Button variant="outline" size="sm">Sign out other devices</Button>}
                  />
                </div>
              </Row>
            </Panel>
          </Section>

          <Section id="data" title="Your data" description="It's yours. Take a full copy whenever you like.">
            <Panel padded={false} className="divide-y divide-border">
              <Row label="Download everything" hint="Accounts, the full ledger, budgets, schedules, loans, investments and your notebook, as one JSON file.">
                <div className="flex justify-end"><Button variant="outline" size="sm" asChild><a href="/api/account/export">Download (JSON)</a></Button></div>
              </Row>
              <div className="grid gap-3 bg-negative-soft/40 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
                <div>
                  <p className="text-sm font-medium text-negative">Delete your account</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">Erases your profile and every account, transaction, budget and investment for good. There&apos;s no undo; download a copy first.</p>
                </div>
                <ConfirmAction
                  title="Delete your account?"
                  requirePhrase="DELETE"
                  description={
                    <>
                      <p>This erases your profile and every account, transaction, budget and investment. There&apos;s no undo. Download a copy first if you might want it.</p>
                      <div className="space-y-1.5 pt-1">
                        <Label htmlFor="del-pw" className="text-xs">Your password</Label>
                        <PasswordInput id="del-pw" value={deletePw} onChange={(e) => setDeletePw(e.target.value)} />
                      </div>
                    </>
                  }
                  confirmLabel="Delete everything"
                  onConfirm={deleteAccount}
                  trigger={<Button variant="outline" size="sm" className="border-negative/40 text-negative hover:bg-negative-soft hover:text-negative">Delete account…</Button>}
                />
              </div>
            </Panel>
          </Section>
        </div>
      </div>

      {dirty && (
        <div role="region" aria-label="Unsaved changes" className="fixed inset-x-0 bottom-16 z-40 flex justify-center px-4 md:bottom-6 md:pl-[236px]">
          <div className="settle flex items-center gap-3 rounded-xl border border-border bg-popover py-2 pr-2 pl-4 shadow-pop">
            <span className="h-1.5 w-1.5 rounded-full bg-brass" aria-hidden />
            <span className="text-sm text-muted-foreground">Unsaved changes</span>
            <Button size="sm" variant="ghost" onClick={() => setS(saved)}>Discard</Button>
            <Button size="sm" onClick={requestSave} disabled={saving || !thresholdOk}>{saving ? "Saving…" : "Save changes"}</Button>
          </div>
        </div>
      )}

      <ConfirmAction
        open={confirmBudget}
        onOpenChange={setConfirmBudget}
        destructive={false}
        title={`Plan every month in ${s.budgetCurrency}?`}
        description={<p>Every month&apos;s budget, including planned income, is converted from {saved.budgetCurrency} to {s.budgetCurrency} at today&apos;s rate, and new months start in {s.budgetCurrency}. Your actual spending isn&apos;t touched.</p>}
        confirmLabel="Save and convert"
        onConfirm={save}
      />
    </div>
  );
}
