import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ValidationError } from "@/lib/validate";
import { DuplicateTransferWarning } from "@/lib/ledger";

type Ctx<P> = { params: Promise<P> };

/**
 * Wraps an authenticated route handler: resolves the session (401 without
 * one), maps ValidationError → 422 (a probable duplicate transfer → 409 with
 * `code: "DUPLICATE"` so the client can ask before re-sending), and turns a
 * plain return value into JSON.
 */
export function authed<P = Record<string, never>>(
  handler: (req: NextRequest, ctx: { userId: string; params: P }) => Promise<unknown>
) {
  return async (req: NextRequest, context: Ctx<P>) => {
    const session = await getSessionUser();
    if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    try {
      const params = (context?.params ? await context.params : {}) as P;
      const result = await handler(req, { userId: session.userId, params });
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (err) {
      if (err instanceof DuplicateTransferWarning) {
        return NextResponse.json({ error: err.message, code: "DUPLICATE", existingId: err.existingId }, { status: 409 });
      }
      if (err instanceof ValidationError) {
        return NextResponse.json(
          { error: err.message, ...(err.fieldErrors ? { fieldErrors: err.fieldErrors } : {}) },
          { status: 422 }
        );
      }
      console.error(`${req.method} ${req.nextUrl.pathname} failed:`, err);
      return NextResponse.json({ error: "Something went wrong on our side. Nothing was saved." }, { status: 500 });
    }
  };
}

export function notFound(what = "Not found.") {
  return NextResponse.json({ error: what }, { status: 404 });
}
