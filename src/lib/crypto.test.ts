import { describe, it, expect } from "vitest";
import { encryptSecret, decryptSecret, isEncrypted, encryptNullable, decryptNullable } from "./crypto";

// S2: tokens must round-trip through AES-256-GCM, and decrypt must pass through
// legacy plaintext unchanged so the rollout doesn't break existing connections.

describe("crypto (token encryption)", () => {
  it("round-trips a value", () => {
    const secret = "trakt-access-token-abc123";
    const enc = encryptSecret(secret);
    expect(enc).not.toBe(secret);
    expect(isEncrypted(enc)).toBe(true);
    expect(decryptSecret(enc)).toBe(secret);
  });

  it("produces different ciphertext each time (random IV) but decrypts the same", () => {
    const a = encryptSecret("same");
    const b = encryptSecret("same");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("same");
    expect(decryptSecret(b)).toBe("same");
  });

  it("passes legacy plaintext through unchanged", () => {
    expect(isEncrypted("plain-legacy-token")).toBe(false);
    expect(decryptSecret("plain-legacy-token")).toBe("plain-legacy-token");
  });

  it("tamper detection: a corrupted ciphertext throws", () => {
    const enc = encryptSecret("secret");
    const tampered = enc.slice(0, -4) + "AAAA";
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("null-safe wrappers", () => {
    expect(encryptNullable(null)).toBeNull();
    expect(encryptNullable(undefined)).toBeNull();
    expect(decryptNullable(null)).toBeNull();
    const enc = encryptNullable("x");
    expect(enc).not.toBeNull();
    expect(decryptNullable(enc)).toBe("x");
  });
});
