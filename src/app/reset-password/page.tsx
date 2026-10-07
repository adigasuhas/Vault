"use client";

import React, { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { AuthShell } from "@/components/brand/AuthShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";

function Spinner() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="w-8 h-8 border-2 border-muted border-t-foreground rounded-full animate-spin" />
    </div>
  );
}


function ResetForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 10) return setError("Use at least 10 characters.");
    if (password !== confirm) return setError("The two passwords don't match.");
    setBusy(true);
    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword: password }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error || "Could not reset the password.");
    setDone(true);
    setTimeout(() => router.push("/login"), 2500);
  }

  return (
    <AuthShell title="Choose a new password" subtitle="At least 10 characters." footer={<>Changed your mind? <Link href="/login" className="font-medium text-foreground underline-offset-4 hover:underline">Sign in</Link></>}>
      {!token ? (
        <p className="text-sm text-muted-foreground">This link is missing its token. <Link href="/forgot-password" className="underline">Request a new one</Link>.</p>
      ) : done ? (
        <p className="rounded-lg bg-positive-soft px-4 py-3 text-sm text-positive">Password updated. Taking you to sign in…</p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <div role="alert" className="rounded-lg border border-negative/30 bg-negative-soft px-3.5 py-2.5 text-sm text-negative">{error}</div>}
          <div className="space-y-1.5"><Label htmlFor="pw">New password</Label><PasswordInput id="pw" autoComplete="new-password" className="h-10" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
          <div className="space-y-1.5"><Label htmlFor="pw2">Confirm it</Label><PasswordInput id="pw2" autoComplete="new-password" className="h-10" value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></div>
          <Button type="submit" size="lg" disabled={busy} className="w-full">{busy ? "Updating…" : "Update password"}</Button>
        </form>
      )}
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <ResetForm />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";
