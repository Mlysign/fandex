// Shared facet layer — the single source of truth for turning an item's source
// data into normalized "facets": tags (genre/keyword), people (by role) and
// companies (by role). Both Insights and Taste Match discovery build on this.
//
// `merge.ts` only keeps the FIRST developer/publisher/director and the top-8
// cast, and never extracts writers, full company lists or networks — so people
// and companies are read straight from `raw_data` here. Tags reuse the merged
// `tags` + `keywords` (which already union genres/keywords across sources).

import { MediaLink, MediaType, Source } from "@/types";
import { categorizeTag } from "@/lib/tags";

export type FacetKind = "tag" | "person" | "company";
export type PersonRole = "director" | "writer" | "creator" | "cast";
export type CompanyRole = "developer" | "publisher" | "studio" | "network";
export type FacetRole = PersonRole | CompanyRole;

export interface Facet {
  kind: FacetKind;
  key: string;       // normalized key used for matching / aggregation
  label: string;     // first-seen display label
  role?: FacetRole;  // people + companies
  category?: string; // tags only — category id from tags.ts
}

// Stable id for dedup + preference-map keys. A person who is both director and
// writer is two distinct facets (role is part of the identity); a tag has no role.
export function facetId(f: { kind: FacetKind; role?: FacetRole; key: string }): string {
  return `${f.kind}|${f.role ?? ""}|${f.key}`;
}

// ── Key normalizers ───────────────────────────────────────────────

// Tags aren't normalized across sources ("Sci-Fi" vs "sci fi") — collapse to a
// stable key: lowercase, hyphens/underscores/whitespace runs → single spaces.
export function tagKey(t: string): string {
  return t.toLowerCase().replace(/[-_\s]+/g, " ").trim();
}

// People: lowercase, strip diacritics + punctuation, collapse whitespace, so
// "Hideo Kojima" / "Bong Joon-ho" dedup cleanly across sources.
export function personKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritical marks
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

// TMDB crew jobs that count as "writer".
const WRITER_JOBS = new Set([
  "Writer", "Screenplay", "Story", "Novel", "Author", "Comic Book",
  "Characters", "Teleplay", "Co-Writer", "Original Story",
]);

const CAST_CAP = 8;   // bound per-item facet count (matters for scoring top-K)
const STUDIO_CAP = 6; // production_companies tail is mostly distributor noise

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

  const addPerson = (name: any, role: PersonRole) => {
    if (typeof name !== "string") return;
    const label = name.trim();
    if (label) push({ kind: "person", role, key: personKey(label), label });
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
    for (const c of (tmdb.credits?.cast ?? []).slice(0, CAST_CAP)) addPerson(c?.name, "cast");
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

  return out;
}
