// S2 migration — encrypt any plaintext OAuth tokens already stored in
// user_identities (access_token / refresh_token). New writes are encrypted by
// the app; this backfills rows written before S2. Idempotent: already-encrypted
// values (the `enc:1:` prefix) are skipped, so re-running is safe.
//
//   npx tsx --env-file=.env scripts/encrypt-tokens.ts --dry-run
//   npx tsx --env-file=.env scripts/encrypt-tokens.ts            # apply
//
// Env: DB_PATH (defaults to ./data/rr.db) + TOKEN_ENCRYPTION_KEY (the SAME key
// the app uses — encrypting with a different key than the app reads with would
// lock everyone out). Back up data/rr.db before applying.
import { query, run } from "@/lib/db";
import { encryptSecret, isEncrypted } from "@/lib/crypto";

const dryRun = process.argv.slice(2).includes("--dry-run");

if (!process.env.TOKEN_ENCRYPTION_KEY) {
  console.error("Refusing to run: TOKEN_ENCRYPTION_KEY is not set (use --env-file=.env). It MUST match the app's key.");
  process.exit(1);
}

const rows = query<{ id: string; provider: string; access_token: string | null; refresh_token: string | null }>(
  "SELECT id, provider, access_token, refresh_token FROM user_identities"
);

let accessEncrypted = 0;
let refreshEncrypted = 0;
let alreadyDone = 0;

for (const r of rows) {
  const access = r.access_token;
  const refresh = r.refresh_token;
  const needAccess = access != null && access !== "" && !isEncrypted(access);
  const needRefresh = refresh != null && refresh !== "" && !isEncrypted(refresh);

  if (!needAccess && !needRefresh) {
    alreadyDone++;
    continue;
  }

  const newAccess = needAccess ? encryptSecret(access!) : access;
  const newRefresh = needRefresh ? encryptSecret(refresh!) : refresh;
  if (needAccess) accessEncrypted++;
  if (needRefresh) refreshEncrypted++;

  console.log(`${dryRun ? "[dry-run] " : ""}${r.provider} (${r.id}): access=${needAccess ? "encrypt" : "skip"} refresh=${needRefresh ? "encrypt" : "skip"}`);
  if (!dryRun) {
    run("UPDATE user_identities SET access_token = ?, refresh_token = ? WHERE id = ?", [newAccess, newRefresh, r.id]);
  }
}

console.log(
  `\n${dryRun ? "[dry-run] " : ""}Done. identities=${rows.length}, already-encrypted=${alreadyDone}, ` +
  `access encrypted=${accessEncrypted}, refresh encrypted=${refreshEncrypted}.`
);
