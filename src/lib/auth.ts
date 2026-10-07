import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";

// A previously hardcoded fallback. Anyone who has seen the source (or the git
// history) knows it, so it can never be a valid signing key again.
const COMPROMISED_JWT_SECRET =
  "vault-ultra-secure-default-jwt-secret-key-replace-in-prod-2026";

function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.trim().length < 32) {
    throw new Error(
      "JWT_SECRET is missing or too short. Set a random value of at least 32 characters " +
        "(e.g. `openssl rand -base64 48`) in the environment before starting the app."
    );
  }
  if (secret === COMPROMISED_JWT_SECRET) {
    throw new Error(
      "JWT_SECRET is set to the old hardcoded fallback, which is public. Rotate it to a fresh random value."
    );
  }
  return secret;
}

const JWT_SECRET = new TextEncoder().encode(resolveJwtSecret());

const SESSION_COOKIE = "vault-session";

export interface SessionPayload {
  userId: string;
  email: string;
  name?: string;
  /** Copied from User.tokenVersion at issue time; a mismatch invalidates the session. */
  tv?: number;
}

export async function signSessionToken(payload: SessionPayload) {
  return await new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(JWT_SECRET);
}

/** Short-lived signed token for multi-step flows (account recovery): proves
 * the client completed the previous step without keeping server state. */
export async function signChallenge(payload: Record<string, unknown>, ttl = "10m") {
  return await new SignJWT({ ...payload, purpose: "recovery" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(JWT_SECRET);
}

export async function verifyChallenge<T extends Record<string, unknown>>(token: string): Promise<T | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, { algorithms: ["HS256"] });
    return payload.purpose === "recovery" ? (payload as unknown as T) : null;
  } catch {
    return null;
  }
}

async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, { algorithms: ["HS256"] });
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

function readToken(req?: NextRequest): Promise<string | undefined> | string | undefined {
  if (req) return req.cookies.get(SESSION_COOKIE)?.value;
  return cookies()
    .then((c) => c.get(SESSION_COOKIE)?.value)
    .catch(() => undefined);
}

/**
 * Resolves the current session AND revalidates it against the database on every
 * call: the user must still exist, be ACTIVE, not soft-deleted, and carry the
 * current tokenVersion. A suspended or deleted user's cookie stops working
 * immediately instead of lasting the 7-day JWT lifetime (finding F4).
 */
export async function getSessionUser(req?: NextRequest): Promise<SessionPayload | null> {
  const token = await readToken(req);
  if (!token) return null;

  const payload = await verifySessionToken(token);
  if (!payload?.userId) return null;

  const user = await db.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, email: true, name: true, status: true, deletedAt: true, tokenVersion: true },
  });
  if (!user || user.deletedAt || user.status !== "ACTIVE") return null;
  if (typeof payload.tv === "number" && payload.tv !== user.tokenVersion) return null;

  return { userId: user.id, email: user.email, name: user.name ?? undefined, tv: user.tokenVersion };
}

/** Full user row for callers that need more than the session payload; same revalidation. */
export async function requireUser(req?: NextRequest) {
  const session = await getSessionUser(req);
  if (!session) return null;
  return db.user.findUnique({ where: { id: session.userId } });
}

/** Full user row, and only if their role is DEVELOPER. */
export async function requireDeveloper(req?: NextRequest) {
  const user = await requireUser(req);
  if (!user || user.role !== "DEVELOPER") return null;
  return user;
}

/**
 * Invalidates every existing session for a user (bumps tokenVersion). Call after
 * a password change, a suspend/disable, or a role change so it takes effect now.
 */
export async function revokeUserSessions(userId: string) {
  await db.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
}

export async function setSessionCookie(payload: SessionPayload) {
  const token = await signSessionToken(payload);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, "", {
    httpOnly: true,
    expires: new Date(0),
    path: "/",
  });
}
