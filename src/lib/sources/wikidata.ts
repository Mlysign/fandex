// Wikidata franchise enrichment (2026-08-14) — the only source that knows a
// SHOW belongs to a franchise. TMDB has no collection concept for series and
// IGDB covers only games, so before this, Andor and The Mandalorian could join
// Star Wars only by hand.
//
// Free, keyless, no account. Reached through the public SPARQL endpoint, which
// answers a batch in one request — 50 ids per query rather than 50 requests.
//
// ── What the properties actually are, measured 2026-08-14, not assumed ──
//
// The obvious choice is P179 "part of the series", and for FILMS AND SHOWS it
// is the wrong one: Star Wars (1977) carries both "Star Wars" and "Star Wars
// original trilogy" under P179, so a sub-series pollutes the franchise facet.
// P8345 "media franchise" is clean there — The Mandalorian, Andor and the 1977
// film all return exactly "Star Wars".
//
// GAMES are the other way round: not one of five sampled Steam titles had
// P8345 at all, while P179 gave "Metal Gear", "The Witcher", "Half-Life",
// "Portal", "Fallout". So the property is chosen per medium, deliberately.
//
// ── Labels need a language fallback, or you store QIDs as franchise names ──
//
// `wikibase:language "en"` alone returns the bare QID for any entity with no
// English label, and that is common for series items: the Half-Life, Portal,
// Fallout and The Last of Us series all came back as "Q752241", "Q7231475",
// "Q167835", "Q28062624". They have `mul` (multilingual) labels instead, so the
// service is asked for "en,mul,en-gb" and anything STILL shaped like a QID is
// dropped rather than written as a franchise called Q28062624.

import { httpFetch } from "@/lib/http";
import { ipKey } from "@/lib/facets";

const ENDPOINT = "https://query.wikidata.org/sparql";

// Wikidata's user-agent policy asks for a descriptive UA with contact info; a
// generic one risks a block for everyone sharing it.
const USER_AGENT = "Fandex/1.0 (https://fandex.org; franchise enrichment)";

// One request per this many ids. 50 keeps the query string well inside any URL
// limit and each batch answered in well under a second in testing.
export const WIKIDATA_BATCH = 50;

// Wikidata is a courtesy service with no contract — it gets a real budget and
// is never allowed to hold up a caller. The circuit breaker in http.ts applies
// per host, so a Wikidata outage opens its own circuit and touches nothing else.
const WIKIDATA_BUDGET_MS = 20_000;

export interface WikidataFranchise { key: string; label: string }

interface SparqlBinding { [k: string]: { value: string } | undefined }

function isBareQid(s: string): boolean {
  return /^Q\d+$/.test(s);
}

async function runSparql(query: string): Promise<SparqlBinding[]> {
  const url = `${ENDPOINT}?query=${encodeURIComponent(query)}`;
  // Throws on failure — deliberately. A caller must never read "no franchise"
  // out of an outage: every write path here is insert-only, so a thrown error
  // writes nothing, while a swallowed one would look like a clean sweep that
  // found nothing and mark the batch done.
  const res = await httpFetch(url, {
    headers: { Accept: "application/sparql-results+json", "User-Agent": USER_AGENT },
    budgetMs: WIKIDATA_BUDGET_MS,
  });
  if (!res.ok) throw new Error(`Wikidata SPARQL ${res.status}`);
  const json = (await res.json()) as { results?: { bindings?: SparqlBinding[] } };
  return json.results?.bindings ?? [];
}

// SPARQL string literals: the only characters that can break out are a quote
// and a backslash. Ids here are IMDb ("tt1234567") and Steam appids (digits),
// both already narrow, but the escape is not conditional on that staying true.
function literals(ids: string[]): string {
  return ids.map((id) => `"${id.replace(/[\\"]/g, "\\$&")}"`).join(" ");
}

function collect(
  bindings: SparqlBinding[],
  idVar: string,
  labelVar: string
): Map<string, WikidataFranchise[]> {
  const out = new Map<string, WikidataFranchise[]>();
  for (const b of bindings) {
    const id = b[idVar]?.value;
    const label = b[labelVar]?.value;
    if (!id || !label || isBareQid(label)) continue;
    const key = ipKey(label);
    if (!key) continue;
    const arr = out.get(id) ?? [];
    if (!arr.some((f) => f.key === key)) arr.push({ key, label });
    out.set(id, arr);
  }
  return out;
}

/** Films and shows, joined on IMDb id (P345) → media franchise (P8345). */
export async function franchisesByImdbId(imdbIds: string[]): Promise<Map<string, WikidataFranchise[]>> {
  if (!imdbIds.length) return new Map();
  const bindings = await runSparql(
    `SELECT ?imdb ?franchiseLabel WHERE {
       VALUES ?imdb { ${literals(imdbIds)} }
       ?item wdt:P345 ?imdb .
       ?item wdt:P8345 ?franchise .
       SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul,en-gb". }
     }`
  );
  return collect(bindings, "imdb", "franchiseLabel");
}

/** Games, joined on Steam application id (P1733) → part of the series (P179). */
export async function franchisesBySteamAppId(appIds: string[]): Promise<Map<string, WikidataFranchise[]>> {
  if (!appIds.length) return new Map();
  const bindings = await runSparql(
    `SELECT ?appid ?seriesLabel WHERE {
       VALUES ?appid { ${literals(appIds)} }
       ?item wdt:P1733 ?appid .
       ?item wdt:P179 ?series .
       SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul,en-gb". }
     }`
  );
  return collect(bindings, "appid", "seriesLabel");
}
