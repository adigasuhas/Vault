"use client";

import { useEffect, useState } from "react";

/**
 * The price: a zero whose currency quietly changes every two seconds.
 * Free in rupees, pounds, dollars, euros, yen and the rest. The symbol
 * slides in from below while the old one leaves upward; the zero never
 * moves. Screen readers get one plain sentence, and with reduced motion
 * the symbol stays put.
 */
// Single-glyph symbols only, so the zero barely shifts as they change.
const CURRENCIES = ["₹", "£", "$", "€", "¥", "₩", "₦", "₺", "₱"];

export function CurrencyZero({ className = "" }: { className?: string }) {
  const [i, setI] = useState(0);
  const [ticked, setTicked] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => {
      setI((n) => (n + 1) % CURRENCIES.length);
      setTicked(true);
    }, 2000);
    return () => window.clearInterval(id);
  }, []);

  const prev = (i - 1 + CURRENCIES.length) % CURRENCIES.length;

  return (
    <span className={`inline-flex items-baseline ${className}`}>
      <span className="sr-only">Free, in any currency</span>
      <span aria-hidden="true" className="relative inline-grid overflow-hidden pr-[0.04em] text-muted-foreground [&>*]:col-start-1 [&>*]:row-start-1 [&>*]:justify-self-end">
        {ticked && <span key={`o${i}`} className="cur-out">{CURRENCIES[prev]}</span>}
        <span key={`i${i}`} className={ticked ? "cur-in" : undefined}>{CURRENCIES[i]}</span>
      </span>
      <span aria-hidden="true">0</span>
    </span>
  );
}
