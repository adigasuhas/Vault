import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { hashPassword, verifyPassword, needsRehash } from "@/lib/crypto";

describe("password hashing", () => {
  it("hashes to the scrypt format and round-trips", () => {
    const h = hashPassword("correct horse battery staple");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(h.split("$")).toHaveLength(6);
    expect(verifyPassword("correct horse battery staple", h)).toBe(true);
  });

  it("rejects the wrong password", () => {
    const h = hashPassword("hunter2hunter2");
    expect(verifyPassword("hunter2hunter3", h)).toBe(false);
  });

  it("produces a unique salt per hash", () => {
    expect(hashPassword("same")).not.toBe(hashPassword("same"));
  });

  it("still verifies a legacy PBKDF2 hash and flags it for rehash", () => {
    const salt = crypto.randomBytes(16).toString("hex");
    const legacyHash = crypto.pbkdf2Sync("legacypw123", salt, 1000, 64, "sha512").toString("hex");
    const stored = `${salt}:${legacyHash}`;
    expect(verifyPassword("legacypw123", stored)).toBe(true);
    expect(verifyPassword("nope", stored)).toBe(false);
    expect(needsRehash(stored)).toBe(true);
  });

  it("does not flag a scrypt hash for rehash", () => {
    expect(needsRehash(hashPassword("x".repeat(12)))).toBe(false);
    expect(needsRehash(null)).toBe(false);
    expect(needsRehash("")).toBe(false);
  });

  it("returns false for a malformed stored hash instead of throwing", () => {
    expect(verifyPassword("x", "garbage")).toBe(false);
    expect(verifyPassword("x", "scrypt$1$2$3")).toBe(false);
  });
});
