// Wikidata, for what no games provider has: the PEOPLE behind a game (2026-10-25,
// the score's data fix c). IGDB carries no credits, so 0 of the pool's 2,709
// games had a person facet while every film had a director and a cast, and
// Kojima, Druckmann and Todd Howard did not exist in the model.
//
// Free, keyless, CC0, one SPARQL request per batch of games. The old site used
// the same endpoint for franchises (2026-08-14, docs/fandex-score.md §3.6.2);
// what it learned still holds and is kept here:
//
//   • Labels need `wikibase:language "en,mul,en-gb"`, or an entity without an
//     English label comes back as its bare QID. Anything still QID-shaped is
//     dropped, never stored as a person called Q28062624.
//   • The endpoint throttles. Batches fired back to back timed out and tripped
//     the circuit breaker within seconds; a pause between queries is what lets
//     an unattended walk finish. The cron asks once a run, so it needs none.
//   • A failed call THROWS. A caller must never read an outage as "Wikidata
//     knows nobody for this game" and write that down.
//
// Two ways to find a game: its Steam app id (P1733), which 1,313 of the pool's
// games carry through their IGDB websites, and its IGDB slug (P5794), which
// every IGDB payload has. Both are asked in one query. Three roles, filed under
// the roles the score already weighs: director (P57) as director, game designer
// (P287) as creator (the role a show's creator and a board game's designer
// share), writer and screenwriter (P50, P58) as writer.

import { httpFetch } from "@/lib/http";

const ENDPOINT = "https://query.wikidata.org/sparql";
// Wikidata's user-agent policy asks for a descriptive UA with contact info.
const USER_AGENT = "Fandex/1.0 (https://fandex.org; game credits)";
/** Games per SPARQL request. Fifty keeps the query well inside any URL limit. */
export const WIKIDATA_BATCH = 50;
/** Wikidata is a courtesy service with no contract: it gets a budget and never holds a caller up. */
const WIKIDATA_BUDGET_MS = 20_000;
/** People kept per role per game. Credits past the first few are a studio's roster, not an author. */
export const WIKIDATA_PEOPLE_CAP = 4;

/** What `wikidata` on an IGDB payload holds once the cron has asked. Empty lists mean asked and nobody listed. */
export interface WikidataGamePeople {
  qid: string | null;
  directors: string[];
  designers: string[];
  writers: string[];
}

interface SparqlBinding { [k: string]: { value: string } | undefined }

const isBareQid = (s: string): boolean => /^Q\d+$/.test(s);

async function runSparql(query: string): Promise<SparqlBinding[]> {
  const res = await httpFetch(`${ENDPOINT}?query=${encodeURIComponent(query)}`, {
    headers: { Accept: "application/sparql-results+json", "User-Agent": USER_AGENT },
    budgetMs: WIKIDATA_BUDGET_MS,
  });
  if (!res.ok) throw new Error(`Wikidata SPARQL ${res.status}`);
  const json = (await res.json()) as { results?: { bindings?: SparqlBinding[] } };
  return json.results?.bindings ?? [];
}

// SPARQL string literals: a quote and a backslash are the only characters that
// break out. App ids are digits and slugs are [a-z0-9-], but the escape is not
// conditional on that staying true.
const literals = (ids: string[]): string => ids.map((id) => `"${id.replace(/[\\"]/g, "\\$&")}"`).join(" ");

const ROLE_OF: Record<string, keyof Omit<WikidataGamePeople, "qid">> = {
  "http://www.wikidata.org/prop/direct/P57": "directors",
  "http://www.wikidata.org/prop/direct/P287": "designers",
  "http://www.wikidata.org/prop/direct/P50": "writers",
  "http://www.wikidata.org/prop/direct/P58": "writers",
};

/** The key a row was found under: `steam:{appid}` or `igdb:{slug}`. */
export type WikidataGameKey = `steam:${string}` | `igdb:${string}`;

/**
 * The people Wikidata lists for each game, by the key it was found under. A
 * game Wikidata knows but lists nobody for is in the map with empty lists; one
 * it does not know at all is absent. The call failing throws.
 */
export async function peopleForGames(keys: { appIds?: string[]; slugs?: string[] }): Promise<Map<WikidataGameKey, WikidataGamePeople>> {
  const appIds = [...new Set(keys.appIds ?? [])];
  const slugs = [...new Set(keys.slugs ?? [])];
  const out = new Map<WikidataGameKey, WikidataGamePeople>();
  if (!appIds.length && !slugs.length) return out;
  const found = [
    appIds.length ? `{ VALUES ?appid { ${literals(appIds)} } ?item wdt:P1733 ?appid . BIND(CONCAT("steam:", ?appid) AS ?key) }` : "",
    slugs.length ? `{ VALUES ?slug { ${literals(slugs)} } ?item wdt:P5794 ?slug . BIND(CONCAT("igdb:", ?slug) AS ?key) }` : "",
  ].filter(Boolean).join(" UNION ");
  // Every matched game comes back at least once (the OPTIONAL), so "known, nobody listed" is told apart from "unknown".
  const bindings = await runSparql(
    `SELECT ?key ?item ?prop ?personLabel WHERE {
       ${found}
       OPTIONAL {
         VALUES ?prop { wdt:P57 wdt:P287 wdt:P50 wdt:P58 }
         ?item ?prop ?person .
       }
       SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul,en-gb". }
     }`,
  );
  for (const b of bindings) {
    const key = b.key?.value as WikidataGameKey | undefined;
    if (!key) continue;
    const entry = out.get(key) ?? { qid: b.item?.value?.split("/").pop() ?? null, directors: [], designers: [], writers: [] };
    out.set(key, entry);
    const role = b.prop?.value ? ROLE_OF[b.prop.value] : undefined;
    const name = b.personLabel?.value?.trim();
    if (!role || !name || isBareQid(name)) continue;
    if (!entry[role].includes(name) && entry[role].length < WIKIDATA_PEOPLE_CAP) entry[role].push(name);
  }
  return out;
}
