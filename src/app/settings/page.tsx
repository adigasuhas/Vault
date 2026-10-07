"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useSession } from "@/context/SessionContext";
import { useCurrency } from "@/context/CurrencyContext";
import { api } from "@/lib/client";
import { SUPPORTED_CURRENCIES } from "@/lib/currencies";
import { SECURITY_QUESTIONS } from "@/lib/security-question-list";
import { PageHeader, SkeletonBlock } from "@/components/app/PageHeader";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ConfirmAction } from "@/components/ConfirmAction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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

function Block({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="settle grid gap-5 border-t border-border py-8 first:border-t-0 first:pt-0 md:grid-cols-[240px_1fr]">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function CurrencySelect({ value, onChange, allowNone }: { value: string | null; onChange: (v: string | null) => void; allowNone?: boolean }) {
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        {allowNone && <SelectItem value={NONE}>None</SelectItem>}
        {SUPPORTED_CURRENCIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.code} · {c.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export default function SettingsPage() {
  const { refreshSession } = useSession();
  const fx = useCurrency();
  const router = useRouter();
  const [s, setS] = useState<Settings | null>(null);
  const [saved, setSaved] = useState<Settings | null>(null);
  const [rates, setRates] = useState<Rate[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [pw, setPw] = useState({ current: "", next: "" });
  const [pwBusy, setPwBusy] = useState(false);
  const [deletePw, setDeletePw] = useState("");
  const [sq, setSq] = useState<{ current: string | null; question: string; answer: string; password: string }>({ current: null, question: "", answer: "", password: "" });
  const [sqBusy, setSqBusy] = useState(false);

  const load = useCallback(async () => {
    const [d, r] = await Promise.all([api<Settings>("/api/settings"), api<{ rates: Rate[] }>("/api/exchange-rates")]);
    setS(d);
    setSaved(d);
    setRates(r.rates);
    const q = await api<{ question: string | null; questionText: string | null }>("/api/auth/security-question");
    setSq((v) => ({ ...v, current: q.questionText, question: v.question || q.question || "" }));
  }, []);
  useEffect(() => {
    load().catch((e) => toast.error(e.message));
  }, [load]);

  if (!s) return <div className="space-y-4"><SkeletonBlock className="h-12 w-60" /><SkeletonBlock className="h-96" /></div>;
  const dirty = JSON.stringify(s) !== JSON.stringify(saved);
  const set = (patch: Partial<Settings>) => setS({ ...s, ...patch });

  async function save() {
    setSaving(true);
    try {
      await api("/api/settings", {
        body: {
          name: s!.name ?? "",
          timezone: s!.timezone,
          baseCurrency: s!.baseCurrency,
          secondaryCurrency: s!.secondaryCurrency,
          budgetCurrency: s!.budgetCurrency,
          exchangeRateMode: s!.exchangeRateMode,
          notifyUpcomingCredits: s!.notifyUpcomingCredits,
          notifyUpcomingBills: s!.notifyUpcomingBills,
          budgetAlertThreshold: Number(s!.budgetAlertThreshold),
        },
      });
      toast.success("Settings saved.");
      await Promise.all([load(), refreshSession()]);
      fx.reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

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

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title="Settings" description="Your profile, currencies and how VAULT looks." />

      <div className="pb-24">
        <Block title="Profile">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="st-name">Name</Label><Input id="st-name" value={s.name ?? ""} onChange={(e) => set({ name: e.target.value })} /></div>
            <div className="space-y-1.5"><Label htmlFor="st-email">Email</Label><Input id="st-email" value={s.email} disabled /></div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Time zone</Label>
              <Select value={s.timezone} onValueChange={(v) => set({ timezone: v })}>
                <SelectTrigger className="w-full sm:w-80"><SelectValue /></SelectTrigger>
                <SelectContent>{[...new Set([s.timezone, "UTC", ...TIMEZONES])].map((tz) => <SelectItem key={tz} value={tz}>{tz}</SelectItem>)}</SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Decides when your day, and your month, begins.</p>
            </div>
          </div>
        </Block>

        <Block
          title="Currencies"
          description="Each account, card and loan keeps its own currency. These settings only change how totals and conversions are shown."
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Primary</Label>
              <CurrencySelect value={s.baseCurrency} onChange={(v) => v && set({ baseCurrency: v, secondaryCurrency: s.secondaryCurrency === v ? saved!.baseCurrency : s.secondaryCurrency })} />
              <p className="text-xs text-muted-foreground">Totals and net worth.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Secondary</Label>
              <CurrencySelect allowNone value={s.secondaryCurrency} onChange={(v) => set({ secondaryCurrency: v === s.baseCurrency ? null : v })} />
              <p className="text-xs text-muted-foreground">Shown as &quot;≈&quot; next to amounts.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Budget in</Label>
              <CurrencySelect value={s.budgetCurrency} onChange={(v) => v && set({ budgetCurrency: v })} />
              <p className="text-xs text-muted-foreground">For new months. Existing months keep theirs.</p>
            </div>
          </div>

          <div className="mt-6 rounded-xl border border-border">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div>
                <p className="text-sm font-medium">Exchange rates</p>
                <p className="text-xs text-muted-foreground">
                  {s.exchangeRateMode === "AUTOMATIC"
                    ? `Live rates, refreshed every 12 hours${fx.asOf ? `. Last update ${new Date(fx.asOf).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}.`
                    : "You set the rates yourself."}
                </p>
              </div>
              <div role="radiogroup" aria-label="Rate source" className="inline-flex rounded-lg bg-muted p-0.5 text-xs">
                {(["AUTOMATIC", "MANUAL"] as const).map((m) => (
                  <button key={m} role="radio" aria-checked={s.exchangeRateMode === m} onClick={() => set({ exchangeRateMode: m })} className={`h-7 cursor-pointer rounded-md px-3 transition-colors ${s.exchangeRateMode === m ? "bg-card font-medium shadow-card" : "text-muted-foreground"}`}>
                    {m === "AUTOMATIC" ? "Live" : "Manual"}
                  </button>
                ))}
              </div>
            </div>
            <ul className="divide-y divide-border">
              {relevant.map((r) => (
                <li key={r.targetCurrency} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="w-40 text-muted-foreground">1 {saved!.baseCurrency} = </span>
                  <span className="w-32 tabular-nums">{r.rate ? `${r.rate.toFixed(4)} ${r.targetCurrency}` : <span className="text-muted-foreground">no rate yet</span>}</span>
                  {r.mode === "MANUAL" && <span className="text-[11px] text-muted-foreground">manual</span>}
                  {s.exchangeRateMode === "MANUAL" && (
                    <span className="ml-auto flex gap-2">
                      <Input type="number" step="0.0001" min="0" placeholder={r.targetCurrency} value={drafts[r.targetCurrency] ?? ""} onChange={(e) => setDrafts((d) => ({ ...d, [r.targetCurrency]: e.target.value }))} className="h-8 w-28" />
                      <Button size="sm" variant="outline" disabled={!drafts[r.targetCurrency]} onClick={() => saveRate(r.targetCurrency)}>Set</Button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </Block>

        <Block title="Appearance">
          <div className="max-w-xs"><ThemeToggle /></div>
        </Block>

        <Block title="Reminders" description="What shows up under the reminders bell.">
          <div className="space-y-4">
            <label className="flex items-center justify-between gap-4">
              <span><span className="block text-sm">Income about to arrive</span><span className="text-xs text-muted-foreground">Scheduled income due soon.</span></span>
              <Switch checked={s.notifyUpcomingCredits} onCheckedChange={(v) => set({ notifyUpcomingCredits: v })} />
            </label>
            <label className="flex items-center justify-between gap-4">
              <span><span className="block text-sm">Bills coming up</span><span className="text-xs text-muted-foreground">Scheduled payments due soon.</span></span>
              <Switch checked={s.notifyUpcomingBills} onCheckedChange={(v) => set({ notifyUpcomingBills: v })} />
            </label>
            <label className="flex items-center justify-between gap-4">
              <span><span className="block text-sm">Budget warning at</span><span className="text-xs text-muted-foreground">Flag a category once it uses this much of its budget.</span></span>
              <span className="flex items-center gap-1.5"><Input type="number" min="1" max="100" value={s.budgetAlertThreshold} onChange={(e) => set({ budgetAlertThreshold: Number(e.target.value) })} className="w-20" />%</span>
            </label>
          </div>
        </Block>

        <Block title="Password" description="Changing it signs you out on every other device.">
          <form onSubmit={changePassword} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div className="space-y-1.5"><Label htmlFor="pw-c">Current password</Label><PasswordInput id="pw-c" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></div>
            <div className="space-y-1.5"><Label htmlFor="pw-n">New password</Label><PasswordInput id="pw-n" autoComplete="new-password" minLength={10} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required /></div>
            <Button type="submit" variant="outline" disabled={pwBusy || pw.next.length < 10}>{pwBusy ? "Updating…" : "Update"}</Button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">At least 10 characters.</p>
        </Block>

        <Block title="Secret question" description="If you forget your password, answering this lets you set a new one.">
          {sq.current ? (
            <p className="mb-4 rounded-lg bg-muted px-3 py-2 text-sm">Current question: <span className="font-medium">{sq.current}</span></p>
          ) : (
            <p className="mb-4 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">You haven&apos;t set one yet, so you couldn&apos;t recover your account if you forgot your password.</p>
          )}
          <form onSubmit={saveQuestion} className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Question</Label>
              <Select value={sq.question} onValueChange={(v) => setSq({ ...sq, question: v })}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Choose a question" /></SelectTrigger>
                <SelectContent>{SECURITY_QUESTIONS.map((q) => <SelectItem key={q.id} value={q.id}>{q.text}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label htmlFor="sq-a">Answer</Label><Input id="sq-a" autoComplete="off" value={sq.answer} onChange={(e) => setSq({ ...sq, answer: e.target.value })} /></div>
            <div className="space-y-1.5"><Label htmlFor="sq-p">Current password</Label><PasswordInput id="sq-p" autoComplete="current-password" value={sq.password} onChange={(e) => setSq({ ...sq, password: e.target.value })} /></div>
            <div className="sm:col-span-2"><Button type="submit" variant="outline" disabled={sqBusy || !sq.question || sq.answer.trim().length < 2 || !sq.password}>{sqBusy ? "Saving…" : sq.current ? "Change question" : "Save question"}</Button></div>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">Answers are stored scrambled. Capitals, spaces and punctuation don&apos;t matter.</p>
        </Block>

        <Block title="Your data" description="It's yours. Take a copy, or delete it all.">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" asChild><a href="/api/account/export">Download everything (JSON)</a></Button>
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
              trigger={<Button variant="ghost" className="text-negative hover:text-negative">Delete my account</Button>}
            />
          </div>
        </Block>
      </div>

      {dirty && (
        <div className="fixed inset-x-0 bottom-16 z-40 flex justify-center px-4 md:bottom-6 md:pl-[236px]">
          <div className="settle flex items-center gap-3 rounded-xl border border-border bg-popover px-4 py-2.5 shadow-pop">
            <span className="text-sm text-muted-foreground">Unsaved changes</span>
            <Button size="sm" variant="ghost" onClick={() => setS(saved)}>Discard</Button>
            <Button size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
