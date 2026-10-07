"use client";

import React, { useEffect, useState } from "react";
import { useSession } from "@/context/SessionContext";
import { useRouter } from "next/navigation";
import { SUPPORTED_CURRENCIES } from "@/lib/currencies";
import { AuthShell } from "@/components/brand/AuthShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const TIMEZONES = Intl.supportedValuesOf ? Intl.supportedValuesOf("timeZone") : ["UTC"];

export default function OnboardingPage() {
  const { user, loading, refreshSession } = useSession();
  const router = useRouter();
  const [name, setName] = useState("");
  const [baseCurrency, setBaseCurrency] = useState("INR");
  const [secondaryCurrency, setSecondaryCurrency] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
    if (user) {
      setName(user.name || "");
      setBaseCurrency(user.baseCurrency || "INR");
      // "UTC" is the column default, not a choice — prefer the browser's zone.
      const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      setTimezone(user.timezone && user.timezone !== "UTC" ? user.timezone : browserTz || "UTC");
    }
  }, [user, loading, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, baseCurrency, secondaryCurrency: secondaryCurrency || null, timezone, isOnboarded: true }),
    });
    await refreshSession();
    router.push("/dashboard");
  };

  const selectClass = "h-10 w-full cursor-pointer rounded-lg border border-input bg-card px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50";
  return (
    <AuthShell title="Set up your vault" subtitle="Three quick basics. Accounts and budgets come next.">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="ob-name">Your name</Label>
          <Input id="ob-name" className="h-10" value={name} onChange={(e) => setName(e.target.value)} required placeholder="Ananya Rao" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ob-cur">Main currency</Label>
            <select id="ob-cur" value={baseCurrency} onChange={(e) => { setBaseCurrency(e.target.value); if (e.target.value === secondaryCurrency) setSecondaryCurrency(""); }} className={selectClass}>
              {SUPPORTED_CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.label}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ob-cur2">Second currency</Label>
            <select id="ob-cur2" value={secondaryCurrency} onChange={(e) => setSecondaryCurrency(e.target.value)} className={selectClass}>
              <option value="">None</option>
              {SUPPORTED_CURRENCIES.filter((c) => c.code !== baseCurrency).map((c) => <option key={c.code} value={c.code}>{c.code} · {c.label}</option>)}
            </select>
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">Totals show in your main currency. If your money lives in two countries, pick a second one and we&apos;ll show quick conversions. Each account still keeps its own currency.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ob-tz">Time zone</Label>
          <select id="ob-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} className={selectClass}>
            {[...new Set([timezone, "UTC", ...TIMEZONES])].map((tz) => <option key={tz} value={tz}>{tz}</option>)}
          </select>
          <p className="text-xs text-muted-foreground">Decides when your day, and your month, begins.</p>
        </div>
        <Button type="submit" size="lg" disabled={saving} className="w-full">{saving ? "Saving…" : "Open my vault"}</Button>
      </form>
    </AuthShell>
  );
}

export const dynamic = "force-dynamic";
