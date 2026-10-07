"use client";

/** Small fetch wrapper for client pages: JSON in/out, throws ApiError with
 * the server's message (and code, e.g. "DUPLICATE") on a non-2xx. */
export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public data?: Record<string, unknown>) {
    super(message);
  }
}

export async function api<T = Record<string, unknown>>(url: string, init?: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<T> {
  const res = await fetch(url, {
    method: init?.method ?? (init?.body !== undefined ? "POST" : "GET"),
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: init?.signal,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(data.error || (res.status === 401 ? "Your session has ended. Sign in again." : "Request failed. Please try again."), res.status, data.code, data);
  }
  return data as T;
}

/** A fresh idempotency key — one per form session, so a double click or a
 * retried request books the transaction once. */
export function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Today's calendar date in the viewer's timezone, as YYYY-MM-DD. */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function localMonth(): string {
  return localToday().slice(0, 7);
}
