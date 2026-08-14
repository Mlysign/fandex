// Shared facet layer — the single source of truth for turning an item's source
// data into normalized "facets": tags (genre/keyword), people (by role) and
// companies (by role). Both Insights and Taste Match discovery build on this.
//
// `merge.ts` only keeps the FIRST developer/publisher/director and the top-8
// cast, and never extracts writers, full company lists or networks — so people
// and companies are read straight from `raw_data` here. Tags reuse the merged
// `tags` + `keywords` (which already union genres/keywords across sources).

import type { MediaLink, MediaType, Source } from "@/types";
import { categorizeTag } from "@/lib/tags";
import { transliterate } from "@/lib/translit";

export type FacetKind = "tag" | "person" | "company" | "ip";
export type PersonRole = "director" | "writer" | "creator" | "cast";
export type CompanyRole = "developer" | "publisher" | "studio" | "network";
// A franchise / shared IP ("Star Wars", "Fallout"). Its own kind rather than a
// company role: it isn't a company, and it must not merge into `/studio`'s
// public page. One role only — the role slot exists so `roleWeights.ip` works
// the same way every other non-tag class weight does.
export type IpRole = "ip";
export type FacetRole = PersonRole | CompanyRole | IpRole;

export interface Facet {
  kind: FacetKind;
  key: string;       // normalized key used for matching / aggregation
  label: string;     // first-seen display label
  role?: FacetRole;  // people + companies
  category?: string; // tags only — category id from tags.ts
  // Q30 (2026-07-19): billing-order prominence for CAST facets only (1 = lead,
  // tapering to a floor for background cast) — absent/1 for every other facet.
  // Applied both when learning taste (analyzeLibraryFacets weights this
  // occurrence's rating into the person's Bayesian average) and when scoring
  // an item (computeFandexScore scales the person's classWeight for THIS
  // item's specific occurrence) — a lead role should move the needle more
  // than a cameo, in both directions.
  prominence?: number;
}

// Stable id for dedup + preference-map keys. A person who is both director and
// writer is two distinct facets (role is part of the identity); a tag has no role.
export function facetId(f: { kind: FacetKind; role?: FacetRole; key: string }): string {
  return `${f.kind}|${f.role ?? ""}|${f.key}`;
}

// ── Key normalizers ───────────────────────────────────────────────

// Tags aren't normalized across sources ("Sci-Fi" vs "sci fi") — collapse to a
// stable key: lowercase, hyphens/underscores/whitespace runs → single spaces.
//
// Deliberately NOT transliterated like personKey/companyKey below. Tag keys are
// PERSISTED (`tag_category_override`, `tag_alias` are keyed by them), so
// changing this normalizer would silently orphan those rows. → translit.ts
export function tagKey(t: string): string {
  return t.toLowerCase().replace(/[-_\s]+/g, " ").trim();
}

// People: lowercase, strip diacritics + punctuation, collapse whitespace, so
// "Hideo Kojima" / "Bong Joon-ho" dedup cleanly across sources.
//
// `transliterate` runs AFTER the combining-mark strip and BEFORE the
// `[^a-z0-9]` strip — that ordering is the whole point. NFD handles letters
// that decompose; transliterate handles the ones that don't ("ø" "ß" "ł"),
// which the strip below would otherwise DELETE rather than fold. See
// translit.ts: this key is also the public URL identity, so a dropped letter
// is a hard 404, not a cosmetic wart.
export function personKey(name: string): string {
  return transliterate(
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, ""), // strip combining diacritical marks
  )
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Trailing legal/role tokens that distinguish the same studio under different
// labels ("Naughty Dog" vs "Naughty Dog, Inc."). Stripped from the END only.
const COMPANY_STRIP = new Set([
  "inc", "llc", "ltd", "ltda", "limited", "gmbh", "co", "corp", "corporation",
  "company", "sa", "ag", "kk", "plc", "bv", "srl", "oy", "ab", "as", "kg",
  "sarl", "spa", "pictures", "picture", "productions", "production",
  "entertainment", "interactive", "games", "game", "studios", "studio",
  "animation", "media", "films", "film", "group", "digital", "software",
  "international", "worldwide", "publishing",
]);

// Companies: people normalization, then peel trailing legal/role tokens.
export function companyKey(name: string): string {
  const parts = personKey(name).split(" ").filter(Boolean);
  while (parts.length > 1 && COMPANY_STRIP.has(parts[parts.length - 1])) parts.pop();
  return parts.join(" ");
}

// The two providers name the same IP differently — TMDB suffixes its movie
// collections ("Star Wars Collection", "Thor Collection") while IGDB's game
// franchises are bare ("Star Wars", "Fallout"). Peeling those trailing words is
// the entire reason a movie and a game end up on ONE facet; without it the
// cross-media link this feature exists for silently doesn't happen.
const IP_STRIP = new Set([
  "collection", "collections", "series", "saga", "franchise", "trilogy",
  "duology", "quadrilogy", "anthology", "universe", "cinematic",
]);

// Franchise / IP: people normalization, then peel the trailing franchise words.
export function ipKey(name: string): string {
  const parts = personKey(name).split(" ").filter(Boolean);
  while (parts.length > 1 && IP_STRIP.has(parts[parts.length - 1])) parts.pop();
  return parts.join(" ");
}

// TMDB crew jobs that count as "writer".
const WRITER_JOBS = new Set([
  "Writer", "Screenplay", "Story", "Novel", "Author", "Comic Book",
  "Characters", "Teleplay", "Co-Writer", "Original Story",
]);

const CAST_CAP = 8;   // bound per-item facet count (matters for scoring top-K)
const STUDIO_CAP = 6; // production_companies tail is mostly distributor noise

// Q30 — billing-order prominence: the top LEAD_CAST_COUNT billed actors count
// fully (1.0), tapering linearly down to CAST_PROMINENCE_FLOOR for the least
// prominent kept cast member. TMDB's cast array already arrives in billing
// order, so `index` here IS billing position.
const LEAD_CAST_COUNT = 3;
const CAST_PROMINENCE_FLOOR = 0.4;
function castProminence(index: number): number {
  if (index < LEAD_CAST_COUNT) return 1;
  const span = Math.max(1, CAST_CAP - LEAD_CAST_COUNT - 1);
  const t = Math.min(1, (index - LEAD_CAST_COUNT) / span);
  return 1 - t * (1 - CAST_PROMINENCE_FLOOR);
}

// ── Extraction ────────────────────────────────────────────────────

// All normalized facets for one item. `merged` supplies tags/keywords (already
// unioned by mergeLinks); people/companies are read from each link's raw_data.
// Deduped by `kind|role|key`, keeping the first-seen display label.
export function extractFacets(
  links: MediaLink[],
  type: MediaType,
  merged: { tags?: string[]; keywords?: string[] }
): Facet[] {
  const out: Facet[] = [];
  const seen = new Set<string>();
  const push = (f: Facet) => {
    if (!f.key) return;
    const id = facetId(f);
    if (seen.has(id)) return;
    seen.add(id);
    out.push(f);
  };

  // Tags (genres + keywords) — reuse the merged union.
  for (const t of [...(merged.tags ?? []), ...(merged.keywords ?? [])]) {
    const key = tagKey(t);
    if (key) push({ kind: "tag", key, label: t, category: categorizeTag(key) });
  }

  const bySource = new Map<Source, any>();
  for (const l of links) bySource.set(l.source, l.rawData);

  const addPerson = (name: any, role: PersonRole, prominence?: number) => {
    if (typeof name !== "string") return;
    const label = name.trim();
    if (label) push({ kind: "person", role, key: personKey(label), label, prominence });
  };
  const addCompany = (name: any, role: CompanyRole) => {
    if (typeof name !== "string") return;
    const label = name.trim();
    if (label) push({ kind: "company", role, key: companyKey(label), label });
  };

  // ── People (TMDB primary; Letterboxd director fallback) ──
  const tmdb = bySource.get("tmdb");
  if (tmdb) {
    const crew: any[] = tmdb.credits?.crew ?? [];
    if (type === "show") {
      for (const c of tmdb.created_by ?? []) addPerson(c?.name, "creator");
    } else {
      for (const c of crew) if (c?.job === "Director") addPerson(c?.name, "director");
    }
    for (const c of crew) if (WRITER_JOBS.has(c?.job)) addPerson(c?.name, "writer");
    (tmdb.credits?.cast ?? []).slice(0, CAST_CAP).forEach((c: any, i: number) => addPerson(c?.name, "cast", castProminence(i)));
  }
  const lb = bySource.get("letterboxd");
  if (lb) for (const d of lb.directors ?? []) addPerson(d?.name, "director");

  // ── Companies ──
  // Games: developers / publishers (rawg + steam + igdb — all, not just first).
  const rawg = bySource.get("rawg");
  if (rawg) {
    for (const d of rawg.developers ?? []) addCompany(d?.name, "developer");
    for (const p of rawg.publishers ?? []) addCompany(p?.name, "publisher");
  }
  const steam = bySource.get("steam");
  if (steam) {
    for (const d of steam.basic_info?.developers ?? []) addCompany(d?.name, "developer");
    for (const p of steam.basic_info?.publishers ?? []) addCompany(p?.name, "publisher");
  }
  const igdb = bySource.get("igdb");
  if (igdb) {
    for (const c of igdb.involved_companies ?? []) {
      if (c?.developer) addCompany(c?.company?.name, "developer");
      if (c?.publisher) addCompany(c?.company?.name, "publisher");
    }
  }
  // Movies / shows: studios (production_companies) + networks.
  if (tmdb) {
    for (const c of (tmdb.production_companies ?? []).slice(0, STUDIO_CAP)) addCompany(c?.name, "studio");
    if (type === "show") for (const n of tmdb.networks ?? []) addCompany(n?.name, "network");
  }
  const trakt = bySource.get("trakt");
  if (trakt && type === "show" && typeof trakt.network === "string") addCompany(trakt.network, "network");

  // ── Franchise / IP ──
  // TMDB `belongs_to_collection` (movies only — TMDB has no collection concept
  // for shows) and IGDB `franchises` (games). Both already arrive with names
  // expanded in the payloads we store, so this needs no extra provider call.
  //
  // ⚠️ Coverage is genuinely partial and asymmetric, measured on the real
  // catalog (2026-08-14): 664 of 2,531 items carry an IP, and of the 14 IPs
  // spanning more than one media type, EVERY one is game+movie — not a single
  // show, because neither source describes one. So a Star Wars film and a Star
  // Wars game share this facet; a Star Wars series does not.
  const addIp = (name: unknown) => {
    if (typeof name !== "string") return;
    const label = name.trim();
    if (label) push({ kind: "ip", role: "ip", key: ipKey(label), label });
  };
  if (tmdb) addIp(tmdb.belongs_to_collection?.name);
  if (igdb) for (const f of igdb.franchises ?? []) addIp(f?.name);

  return out;
}
