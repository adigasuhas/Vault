"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSession } from "@/context/SessionContext";

interface FxState {
  primary: string;
  secondary: string | null;
  budgetCurrency: string;
  asOf: string | null;
  stale: boolean;
  toPrimary: Record<string, number | null>;
  toSecondary: Record<string, number | null>;
}

interface CurrencyApi extends FxState {
  ready: boolean;
  /** The "other" currency an amount should be shown in alongside its native
   * one: primary, unless it's already in primary — then secondary. */
  equivalent: (amount: number, currency: string) => { amount: number; currency: string } | null;
  /** Converts to primary (null when no rate is known). */
  toPrimaryAmount: (amount: number, currency: string) => number | null;
  /** Converts to secondary (null when there's no secondary or no rate). */
  toSecondaryAmount: (amount: number, currency: string) => number | null;
  reload: () => void;
}

const Ctx = createContext<CurrencyApi | null>(null);

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const [state, setState] = useState<FxState | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    fetch("/api/fx", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && d && setState(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [user, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const api = useMemo<CurrencyApi>(() => {
    const s: FxState = state ?? {
      primary: user?.baseCurrency ?? "INR",
      secondary: null,
      budgetCurrency: user?.baseCurrency ?? "INR",
      asOf: null,
      stale: true,
      toPrimary: {},
      toSecondary: {},
    };
    return {
      ...s,
      ready: !!state,
      reload,
      toPrimaryAmount: (amount, currency) => {
        if (currency === s.primary) return amount;
        const r = s.toPrimary[currency];
        return r == null ? null : amount * r;
      },
      toSecondaryAmount: (amount, currency) => {
        if (!s.secondary) return null;
        if (currency === s.secondary) return amount;
        const r = s.toSecondary[currency];
        return r == null ? null : amount * r;
      },
      equivalent: (amount, currency) => {
        if (!state) return null;
        if (currency !== s.primary) {
          const r = s.toPrimary[currency];
          return r == null ? null : { amount: amount * r, currency: s.primary };
        }
        if (s.secondary && s.secondary !== currency) {
          const r = s.toSecondary[currency];
          return r == null ? null : { amount: amount * r, currency: s.secondary };
        }
        return null;
      },
    };
  }, [state, user, reload]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useCurrency() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCurrency must be used inside CurrencyProvider");
  return v;
}
