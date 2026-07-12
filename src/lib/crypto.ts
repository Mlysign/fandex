import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

// Application-level encryption for secrets at rest (S2) — specifically the OAuth
// access/refresh tokens in user_identities. A DB or backup leak must not hand an
// attacker usable tokens for every connected account.
//
// AES-256-GCM (authenticated). The key comes from TOKEN_ENCRYPTION_KEY, DISTINCT
// from JWT_SECRET (compromising one must not compromise the other). We SHA-256
// the env value so any sufficiently-random string works (e.g. `openssl rand -hex
// 32`). Ciphertext is stored as `enc:1:<iv>:<tag>:<data>` (all base64).
//
// ROLLOUT-SAFE: decryptSecret() passes through any value WITHOUT the `enc:1:`
// prefix unchanged, so pre-existing plaintext tokens keep working until they're
// re-encrypted (on the next token refresh, a reconnect, or the one-off
// scripts/encrypt-tokens.ts migration).

const PREFIX = "enc:1:";

let _key: Buffer | null = null;
function key(): Buffer {
  if (_key) return _key;
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (raw) return (_key = createHash("sha256").update(raw).digest());
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY is required in production. Generate one with `openssl rand -hex 32` and set it in the environment."
    );
  }
  // Clearly-insecure dev/test fallback so `npm run dev` and tests work.
  return (_key = createHash("sha256").update("dev-only-insecure-token-key-rr2").digest());
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + [iv.toString("base64"), tag.toString("base64"), data.toString("base64")].join(":");
}

export function decryptSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored; // legacy plaintext — pass through
  const [ivB, tagB, dataB] = stored.slice(PREFIX.length).split(":");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB, "base64"));
  decipher.setAuthTag(Buffer.from(tagB, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB, "base64")), decipher.final()]).toString("utf8");
}

// Null-safe wrappers for nullable columns (refresh_token is often null).
export function encryptNullable(v: string | null | undefined): string | null {
  return v == null ? null : encryptSecret(v);
}
export function decryptNullable(v: string | null | undefined): string | null {
  return v == null ? null : decryptSecret(v);
}
