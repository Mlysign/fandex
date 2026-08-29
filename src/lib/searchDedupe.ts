// Deduping the Discover search's two halves (local catalog + live providers).
//
// A LEAF module on purpose: `DiscoverPageClient` is a client component, so
// nothing it reaches may pull in `db.ts` (see AGENTS.md). This file imports
// nothing, which is also what makes it unit-testable — it used to be two
// module-scoped functions inside the 900-line client component, where the bug
// below could not be pinned by a test.
//
// ── Why the title key carries a YEAR (2026-08-29) ────────────────────────────
// It didn't, and that is why a new show never reached the screen. The key was
// `t:{title}:{type}`, so the FIRST work with a given title claimed the name for
// every other work sharing it — and the provider list arrives from
// /api/discover sorted by release date ASCENDING, so the winner was always the
// OLDEST. Searching "Lucky" returned both the 2003 FX series and the 2026
// Apple TV+ one; the 2003 row claimed `t:lucky:show` and the new one was
// dropped before it was ever rendered. Same title, different work, no error,
// no empty state — just a title the search insisted did not exist.
//
// The cost of the year is the opposite case: the SAME work carrying two
// different release dates across two sources no longer collapses on title
// alone, so it can render twice. That trade is deliberate. The id keys below
// (`tmdb:1234`) already catch the same work whenever either side carries a
// provider id, which is the common case; the title key is only the fallback for
// when they don't. A visible duplicate is a cosmetic fault the user can see and
// reason about. A silent drop is indistinguishable from "we don't have it".

export interface DedupeKeyed {
  title?: string | null;
  type?: string | null;
  releaseDate?: string | null;
  sources?: { source: string; sourceId: string }[];
  ids?: Record<string, unknown>;
}

/** Every key an item is known by — its provider ids, plus title+type+year. */
export function itemKeys(item: DedupeKeyed): string[] {
  const ks: string[] = [];
  for (const s of item.sources ?? []) ks.push(`${s.source}:${s.sourceId}`);
  for (const [src, id] of Object.entries(item.ids ?? {})) ks.push(`${src}:${id}`);
  ks.push(`t:${(item.title ?? "").toLowerCase()}:${item.type}:${(item.releaseDate ?? "").slice(0, 4)}`);
  return ks;
}

/** Drop external matches already present locally; also dedupe within the web set. */
export function dedupeWeb<T extends DedupeKeyed>(local: DedupeKeyed[], web: T[]): T[] {
  const keys = new Set<string>();
  for (const it of local) for (const k of itemKeys(it)) keys.add(k);
  const out: T[] = [];
  for (const w of web) {
    const ks = itemKeys(w);
    if (ks.some((k) => keys.has(k))) continue;
    for (const k of ks) keys.add(k);
    out.push(w);
  }
  return out;
}
