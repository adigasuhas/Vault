"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "@/context/SessionContext";
import { AuthShell } from "@/components/brand/AuthShell";
import { useSignupOpen } from "@/lib/use-signup-open";
import { SECURITY_QUESTIONS } from "@/lib/security-question-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Field = "name" | "email" | "password" | "confirmPassword" | "securityQuestion" | "securityAnswer";

export default function SignUpPage() {
  const { refreshSession } = useSession();
  const router = useRouter();
  const signupOpen = useSignupOpen();
  const [f, setF] = useState<Record<Field, string>>({ name: "", email: "", password: "", confirmPassword: "", securityQuestion: "", securityAnswer: "" });
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: Field, v: string) => setF((s) => ({ ...s, [k]: v }));

  function validate() {
    const e: Partial<Record<Field, string>> = {};
    if (!f.name.trim()) e.name = "Tell us what to call you.";
    if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) e.email = "That email doesn't look right.";
    if (f.password.length < 10) e.password = "Use at least 10 characters.";
    if (f.confirmPassword !== f.password) e.confirmPassword = "The passwords don't match.";
    if (!f.securityQuestion) e.securityQuestion = "Pick a question.";
    if (f.securityAnswer.replace(/[^\p{L}\p{N}]/gu, "").length < 2) e.securityAnswer = "Give an answer with at least 2 letters or numbers.";
    return e;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const local = validate();
    setErrors(local);
    if (Object.keys(local).length) return;
    setBusy(true);
    const res = await fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "We couldn't create your account. Try again.");
      setErrors(data.fieldErrors || {});
      return;
    }
    await refreshSession();
    router.push("/onboarding");
  }

  const input = (key: Field, label: string, props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <div className="space-y-1.5">
      <Label htmlFor={`su-${key}`}>{label}</Label>
      {props.type === "password" ? (
        <PasswordInput id={`su-${key}`} className="h-10" aria-invalid={!!errors[key]} value={f[key]} onChange={(e) => set(key, e.target.value)} {...{ ...props, type: undefined }} />
      ) : (
        <Input id={`su-${key}`} className="h-10" aria-invalid={!!errors[key]} value={f[key]} onChange={(e) => set(key, e.target.value)} {...props} />
      )}
      {errors[key] && <p className="text-xs text-negative">{errors[key]}</p>}
    </div>
  );

  return (
    <AuthShell
      title="Create your account"
      subtitle="Free, private, and set up in a minute."
      footer={<>Already have an account? <Link href="/login" className="font-medium text-foreground underline-offset-4 hover:underline">Sign in</Link></>}
    >
      {signupOpen === false && (
        <div className="mb-5 rounded-lg border border-border bg-muted px-3.5 py-3 text-sm text-muted-foreground">
          Sign-ups are closed on this VAULT. If you already have an account, <Link href="/login" className="font-medium text-foreground underline-offset-4 hover:underline">sign in</Link>.
        </div>
      )}
      {error && <div role="alert" className="mb-5 rounded-lg border border-negative/30 bg-negative-soft px-3.5 py-2.5 text-sm text-negative">{error}</div>}
      <form onSubmit={submit} className="space-y-4" noValidate>
        {input("name", "Your name", { autoComplete: "name" })}
        {input("email", "Email", { type: "email", autoComplete: "email" })}
        <div className="grid gap-4 sm:grid-cols-2">
          {input("password", "Password", { type: "password", autoComplete: "new-password" })}
          {input("confirmPassword", "Repeat password", { type: "password", autoComplete: "new-password" })}
        </div>
        <p className="-mt-2 text-xs text-muted-foreground">At least 10 characters. A short sentence works well.</p>

        <fieldset className="space-y-3 rounded-xl border border-border p-4">
          <legend className="px-1 text-sm font-medium">Secret question</legend>
          <p className="-mt-1 text-xs text-muted-foreground">If you forget your password, you&apos;ll answer this to set a new one. Pick something only you&apos;d know, and that you&apos;ll still remember in a year.</p>
          <div className="space-y-1.5">
            <Label className="sr-only">Question</Label>
            <Select value={f.securityQuestion} onValueChange={(v) => set("securityQuestion", v)}>
              <SelectTrigger className="h-10 w-full" aria-invalid={!!errors.securityQuestion}><SelectValue placeholder="Choose a question" /></SelectTrigger>
              <SelectContent>{SECURITY_QUESTIONS.map((q) => <SelectItem key={q.id} value={q.id}>{q.text}</SelectItem>)}</SelectContent>
            </Select>
            {errors.securityQuestion && <p className="text-xs text-negative">{errors.securityQuestion}</p>}
          </div>
          {input("securityAnswer", "Your answer", { autoComplete: "off" })}
          <p className="text-xs text-muted-foreground">Capitals, spaces and punctuation don&apos;t matter. We store it scrambled, so not even we can read it.</p>
        </fieldset>

        <Button type="submit" size="lg" disabled={busy || signupOpen === false} className="w-full">{busy ? "Creating account…" : "Create account"}</Button>
      </form>
    </AuthShell>
  );
}

export const dynamic = "force-dynamic";
