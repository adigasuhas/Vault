"use client";

import React, { useState } from "react";
import Link from "next/link";
import { AuthShell } from "@/components/brand/AuthShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Step = "email" | "question" | "password" | "done";

/**
 * Password recovery by secret question:
 * 1. email → the account's question (or a decoy, so accounts can't be probed)
 * 2. answer → checked on the server; only a match unlocks step 3
 * 3. new password (+ repeat) → set, every other session signed out
 */
export default function ForgotPasswordPage() {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [question, setQuestion] = useState("");
  const [challenge, setChallenge] = useState("");
  const [answer, setAnswer] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [pw, setPw] = useState({ next: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function post(url: string, body: unknown) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  }

  async function startRecovery(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError("Enter the email you signed up with.");
    setBusy(true);
    const { ok, data } = await post("/api/auth/recovery/start", { email });
    setBusy(false);
    if (!ok) return setError(data.error || "Something went wrong. Try again.");
    setQuestion(data.question);
    setChallenge(data.challenge);
    setStep("question");
  }

  async function checkAnswer(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!answer.trim()) return setError("Enter your answer.");
    setBusy(true);
    const { ok, data } = await post("/api/auth/recovery/verify", { challenge, answer });
    setBusy(false);
    if (!ok) {
      setError(data.error || "That answer doesn't match.");
      if (/expired/i.test(data.error ?? "")) setStep("email");
      return;
    }
    setResetToken(data.resetToken);
    setAnswer("");
    setStep("password");
  }

  async function setNewPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (pw.next.length < 10) return setError("Use at least 10 characters.");
    if (pw.next !== pw.confirm) return setError("The passwords don't match.");
    setBusy(true);
    const { ok, data } = await post("/api/auth/reset-password", { token: resetToken, newPassword: pw.next, confirmPassword: pw.confirm });
    setBusy(false);
    if (!ok) return setError(data.error || "We couldn't set your password. Start again.");
    setStep("done");
  }

  const steps: Step[] = ["email", "question", "password"];
  const titles: Record<Step, string> = {
    email: "Forgot your password?",
    question: "Answer your secret question",
    password: "Choose a new password",
    done: "You're all set",
  };
  const subtitles: Record<Step, string> = {
    email: "No problem. Enter your email and we'll ask you your secret question.",
    question: "Get it right and you can set a new password straight away.",
    password: "At least 10 characters. You'll be signed out on every other device.",
    done: "Your password has been changed. Sign in with the new one.",
  };

  return (
    <AuthShell
      title={titles[step]}
      subtitle={subtitles[step]}
      footer={step !== "done" ? <>Remembered it? <Link href="/login" className="font-medium text-foreground underline-offset-4 hover:underline">Sign in</Link></> : undefined}
    >
      {step !== "done" && (
        <ol className="mb-6 flex gap-1.5" aria-label="Progress">
          {steps.map((s, i) => (
            <li key={s} className={cn("h-1 flex-1 rounded-full transition-colors", steps.indexOf(step) >= i ? "bg-brass" : "bg-muted")} aria-current={s === step ? "step" : undefined} />
          ))}
        </ol>
      )}
      {error && <div role="alert" className="mb-5 rounded-lg border border-negative/30 bg-negative-soft px-3.5 py-2.5 text-sm text-negative">{error}</div>}

      {step === "email" && (
        <form onSubmit={startRecovery} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="fp-email">Email</Label>
            <Input id="fp-email" type="email" autoComplete="email" className="h-10" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </div>
          <Button type="submit" size="lg" disabled={busy} className="w-full">{busy ? "Looking it up…" : "Continue"}</Button>
        </form>
      )}

      {step === "question" && (
        <form onSubmit={checkAnswer} className="space-y-4" noValidate>
          <div className="rounded-xl border border-border bg-card px-4 py-3">
            <p className="eyebrow">Your question</p>
            <p className="mt-1 font-medium">{question}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fp-answer">Your answer</Label>
            <Input id="fp-answer" autoComplete="off" className="h-10" value={answer} onChange={(e) => setAnswer(e.target.value)} autoFocus />
            <p className="text-xs text-muted-foreground">Capitals, spaces and punctuation don&apos;t matter.</p>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="lg" onClick={() => { setStep("email"); setError(null); setAnswer(""); }}>Back</Button>
            <Button type="submit" size="lg" disabled={busy} className="flex-1">{busy ? "Checking…" : "Check answer"}</Button>
          </div>
        </form>
      )}

      {step === "password" && (
        <form onSubmit={setNewPassword} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="fp-new">New password</Label>
            <PasswordInput id="fp-new" autoComplete="new-password" className="h-10" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fp-confirm">Repeat it</Label>
            <PasswordInput id="fp-confirm" autoComplete="new-password" className="h-10" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
          </div>
          <Button type="submit" size="lg" disabled={busy} className="w-full">{busy ? "Saving…" : "Set new password"}</Button>
        </form>
      )}

      {step === "done" && (
        <div className="space-y-5">
          <div className="flex items-center gap-3 rounded-xl border border-positive/30 bg-positive-soft px-4 py-3 text-sm text-positive">
            <CheckCircle2 className="h-5 w-5 shrink-0" /> Password changed.
          </div>
          <Button asChild size="lg" className="w-full"><Link href="/login">Sign in</Link></Button>
        </div>
      )}
    </AuthShell>
  );
}

export const dynamic = "force-dynamic";
