import crypto from "crypto";

/**
 * Password hashing.
 *
 * New hashes use scrypt (N=2^15, r=8, p=1) — an OWASP-recommended memory-hard
 * KDF, serialized as `scrypt$<N>$<r>$<p>$<saltHex>$<hashHex>`.
 *
 * Legacy hashes (`<saltHex>:<hashHex>`, PBKDF2-SHA512 x1000) are still verified
 * so existing users can sign in, and `needsRehash()` lets the auth routes
 * transparently upgrade them to scrypt on their next successful login.
 */

const SCRYPT_N = 1 << 15; // CPU/memory cost
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEYLEN = 64;
// 128 * N * r bytes are needed internally; give scrypt headroom over the 32 MiB default.
const SCRYPT_MAXMEM = 128 * SCRYPT_N * SCRYPT_R * 2;

const LEGACY_PBKDF2_ITERATIONS = 1000;

function scryptHash(password: string, salt: Buffer): Buffer {
  return crypto.scryptSync(password, salt, KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = scryptHash(password, salt);
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

function verifyScrypt(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6) return false;
  const [, nStr, rStr, pStr, saltHex, hashHex] = parts;
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  let candidate: Buffer;
  try {
    candidate = crypto.scryptSync(password, salt, expected.length || KEYLEN, {
      N,
      r,
      p,
      maxmem: 128 * N * r * 2,
    });
  } catch {
    return false;
  }
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function verifyLegacyPbkdf2(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = crypto
    .pbkdf2Sync(password, salt, LEGACY_PBKDF2_ITERATIONS, 64, "sha512")
    .toString("hex");
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(candidate, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function verifyPassword(password: string, stored: string): boolean {
  if (!stored) return false;
  if (stored.startsWith("scrypt$")) return verifyScrypt(password, stored);
  if (stored.includes(":")) return verifyLegacyPbkdf2(password, stored);
  return false;
}

/** True when `stored` is a legacy PBKDF2 hash that should be re-hashed to scrypt. */
export function needsRehash(stored: string | null | undefined): boolean {
  if (!stored) return false;
  return !stored.startsWith("scrypt$");
}
