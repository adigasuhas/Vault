"use client";

import Link from "next/link";
import { AuthShell } from "@/components/brand/AuthShell";
import { useSignupOpen } from "@/lib/use-signup-open";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";

import React, { useState, useEffect, Suspense } from "react";
import { useSession } from "@/context/SessionContext";
import { useRouter, useSearchParams } from "next/navigation";
import { ShieldAlert } from "lucide-react";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen bg-background">
          <div className="w-8 h-8 border-2 border-muted border-t-foreground rounded-full animate-spin" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const { user, login, loading } = useSession();
  const signupOpen = useSignupOpen() === true;
  const router = useRouter();
  const searchParams = useSearchParams();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (user && !loading) router.push("/dashboard");
  }, [user, loading, router]);

  useEffect(() => {
    const errorParam = searchParams.get("error");
    if (errorParam) setErrorMsg(`Authentication error: ${errorParam}`);
  }, [searchParams]);

  const handleCredentialsSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setSigningIn(true);
    setErrorMsg(null);

    const result = await login(email, password);
    if (!result.success) {
      setErrorMsg(result.error || "Invalid email or password.");
      setSigningIn(false);
    }
  };

  return (
    <AuthShell title="Sign in" subtitle="Welcome back." footer={signupOpen ? <>New to VAULT? <Link href="/signup" className="font-medium text-foreground underline-offset-4 hover:underline">Create an account</Link></> : undefined}>
      {errorMsg && (
        <div role="alert" className="mb-5 flex items-start gap-2.5 rounded-lg border border-negative/30 bg-negative-soft px-3.5 py-3 text-sm text-negative">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}
      <form onSubmit={handleCredentialsSignIn} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com" className="h-10" />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link href="/forgot-password" className="text-xs text-muted-foreground hover:text-foreground">Forgot it?</Link>
          </div>
          <PasswordInput id="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required className="h-10" />
        </div>
        <Button type="submit" size="lg" disabled={signingIn} className="w-full">
          {signingIn ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthShell>
  );
}

export const dynamic = "force-dynamic";
