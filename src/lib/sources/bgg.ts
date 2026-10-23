// BoardGameGeek: board games (2026-10-17).
//
// ⚠️ BGG's XML API needs a REGISTERED APPLICATION and its token on every
// request since 2025 (boardgamegeek.com/using_the_xml_api, version 2025-07-02):
// a request without one is answered 401. Their terms that shape this file:
//   • requests from our server, cached; never from the device;
//   • a site funded by donations needs a COMMERCIAL licence ("most likely
//     free"), applied for when registering;
//   • every public page using the data shows "Powered by BGG", linked to BGG.
// Until Nils has a token, `BGG_TOKEN` is unset and every function here answers
// "not configured" without a request: board games are then switched off, the
// way IGDB_ENABLED=0 switches games off. Nothing else breaks.
//
// The API answers XML, and a Worker has no DOMParser. The documents are flat
// (one level of <item>, attributes and a few text nodes), so a small reader
// does: `items`, `attr`, `links`, `text`. Fixtures in bgg.test.ts follow BGG's
// documented shapes.

import { httpFetch, BROWSE_BUDGET_MS } from "@/lib/http";
import { bggRating } from "@/lib/sources/bggPure";

export * from "@/lib/sources/bggPure";

const BASE = "https://boardgamegeek.com/xmlapi2";

let tokenSource: () => string | undefined = () => (typeof process !== "undefined" ? process.env?.BGG_TOKEN : undefined);
/** The Worker hands its secret over here (worker/src/catalog/resolve.ts); tests hand a fake one. */
export function setBggToken(read: () => string | undefined): void {
  tokenSource = read;
}
export function bggConfigured(): boolean {
  return !!tokenSource()?.trim();
}

export class BggNotConfigured extends Error {
  constructor() {
    super("Board games are switched off: no BGG application token (BGG_TOKEN).");
    this.name = "BggNotConfigured";
  }
}

async function getXml(path: string, budgetMs?: number): Promise<string | null> {
  const token = tokenSource()?.trim();
  if (!token) throw new BggNotConfigured();
  const res = await httpFetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/xml" },
    // An application token: a run of 401s means OUR token is bad, for everybody.
    appScopedAuth: true,
    ...(budgetMs ? { budgetMs } : {}),
  });
  if (res.status === 404) return null;
  // BGG queues some requests and answers 202 "try again" with no body.
  if (res.status === 202) throw new Error("BGG queued the request");
  if (!res.ok) throw new Error(`BGG error: ${res.status} ${path}`);
  return res.text();
}

// ── The XML reader ──────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#10": "\n", "#13": "", "#039": "'", "#39": "'", mdash: "-", ndash: "-", hellip: "…", rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"' };
// `String.fromCodePoint` THROWS past U+10FFFF, so one bad entity in one
// description (`&#99999999;`) failed the whole batch. An entity that names no
// character is left as written.
const codePoint = (n: number, m: string) => (Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m);
export function decode(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (m, h: string) => codePoint(parseInt(h, 16), m))
    .replace(/&#(\d+);/g, (m, d: string) => (ENTITIES[`#${d}`] ?? codePoint(Number(d), m)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m);
}

/** Every `<item …>…</item>` (or self-closing `<item …/>`), as its opening tag's attributes and its inner XML. */
export function items(xml: string): { attrs: string; body: string }[] {
  const out: { attrs: string; body: string }[] = [];
  const re = /<item\b([^>]*?)(\/>|>([\s\S]*?)<\/item>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push({ attrs: m[1], body: m[3] ?? "" });
  return out;
}

/** An attribute from an opening tag's attribute text. */
export function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
  return m ? decode(m[1]) : null;
}

/** The `value` of the first `<tag …/>` in `body`, optionally where another attribute matches. */
export function valueOf(body: string, tag: string, where?: [string, string]): string | null {
  const re = new RegExp(`<${tag}\\b([^>]*?)\\/?>`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    if (where && attr(m[1], where[0]) !== where[1]) continue;
    return attr(m[1], "value");
  }
  return null;
}

/** Text content of `<tag>…</tag>`. */
export function text(body: string, tag: string): string | null {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`).exec(body);
  return m ? decode(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).trim() : null;
}

/** Every `<link type="…" id="…" value="…"/>`, grouped by type. */
export function links(body: string): Record<string, { id: string; value: string }[]> {
  const out: Record<string, { id: string; value: string }[]> = {};
  const re = /<link\b([^>]*?)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const type = attr(m[1], "type");
    const id = attr(m[1], "id");
    const value = attr(m[1], "value");
    if (!type || !id || !value) continue;
    (out[type] ??= []).push({ id, value });
  }
  return out;
}

const num = (v: string | null): number | null => {
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
};

// ── One game, as a record ───────────────────────────────────────────────────

/** A board game as the catalog keeps it: the parts of BGG's `thing` a page and the score read. */
export interface BggThing {
  id: string;
  name: string;
  year: number | null;
  description: string | null;
  image: string | null;
  thumbnail: string | null;
  minPlayers: number | null;
  maxPlayers: number | null;
  playingTime: number | null;
  minAge: number | null;
  categories: string[];
  mechanics: string[];
  families: string[];
  designers: string[];
  artists: string[];
  publishers: string[];
  /** BGG's average (1-10) and how many rated it. */
  average: number | null;
  usersRated: number | null;
  rank: number | null;
  /** Weight, 1 (light) to 5 (heavy). */
  weight: number | null;
}

/** Read one `<item>` of a `thing` answer. */
export function parseThing(item: { attrs: string; body: string }): BggThing | null {
  const id = attr(item.attrs, "id");
  const name = valueOf(item.body, "name", ["type", "primary"]) ?? valueOf(item.body, "name");
  if (!id || !name) return null;
  const l = links(item.body);
  const names = (t: string, cap = 12) => (l[t] ?? []).map((x) => x.value).slice(0, cap);
  const rankValue = valueOf(item.body, "rank", ["name", "boardgame"]);
  return {
    id, name,
    year: num(valueOf(item.body, "yearpublished")),
    description: text(item.body, "description"),
    image: text(item.body, "image"),
    thumbnail: text(item.body, "thumbnail"),
    minPlayers: num(valueOf(item.body, "minplayers")),
    maxPlayers: num(valueOf(item.body, "maxplayers")),
    playingTime: num(valueOf(item.body, "playingtime")),
    minAge: num(valueOf(item.body, "minage")),
    categories: names("boardgamecategory"),
    mechanics: names("boardgamemechanic"),
    families: names("boardgamefamily", 20),
    designers: names("boardgamedesigner", 6),
    artists: names("boardgameartist", 6),
    publishers: names("boardgamepublisher", 4),
    average: num(valueOf(item.body, "average")),
    usersRated: num(valueOf(item.body, "usersrated")),
    rank: rankValue && rankValue !== "Not Ranked" ? num(rankValue) : null,
    weight: num(valueOf(item.body, "averageweight")),
  };
}

/** One board game by BGG id, with its statistics. Null when BGG has no such game. */
export async function getBggThing(id: string): Promise<BggThing | null> {
  if (!/^\d{1,9}$/.test(id)) return null;
  const xml = await getXml(`/thing?id=${id}&type=boardgame&stats=1`);
  if (!xml) return null;
  const first = items(xml)[0];
  return first ? parseThing(first) : null;
}

export interface BoardGameCard {
  source: "bgg";
  sourceId: string;
  type: "boardgame";
  title: string;
  releaseDate: string | null;
  posterUrl: string | null;
  votes: number;
  /** 0-100, from BGG's 1-10 average. */
  rating: number | null;
}

export function thingCard(t: BggThing): BoardGameCard {
  return {
    source: "bgg", sourceId: t.id, type: "boardgame", title: t.name,
    releaseDate: t.year ? String(t.year) : null, posterUrl: t.image ?? t.thumbnail,
    votes: t.usersRated ?? 0, rating: bggRating(t.average),
  };
}

/**
 * Several games at once with their statistics: BGG's `thing` takes up to 20
 * ids, so a search's or a list's games are one request, not twenty.
 */
export async function getBggThings(ids: string[]): Promise<BggThing[]> {
  const clean = ids.filter((id) => /^\d{1,9}$/.test(id)).slice(0, 20);
  if (!clean.length) return [];
  const xml = await getXml(`/thing?id=${clean.join(",")}&type=boardgame&stats=1`, BROWSE_BUDGET_MS);
  return xml ? items(xml).map(parseThing).filter((t): t is BggThing => !!t) : [];
}

/** Board games by name, best known first. BGG's search has no statistics, so the hits are looked up in one more request. */
export async function searchBgg(query: string, limit = 20): Promise<BoardGameCard[]> {
  const q = query.trim().slice(0, 100);
  if (q.length < 2) return [];
  const xml = await getXml(`/search?query=${encodeURIComponent(q)}&type=boardgame`, BROWSE_BUDGET_MS);
  if (!xml) return [];
  const ids = items(xml).map((i) => attr(i.attrs, "id")).filter((id): id is string => !!id);
  const things = await getBggThings(ids.slice(0, 20));
  return things.map(thingCard).sort((a, b) => b.votes - a.votes).slice(0, limit);
}

/** BGG's "hotness": what is being looked at this week. Home's popular board games. */
export async function hotBgg(limit = 30): Promise<BoardGameCard[]> {
  const xml = await getXml(`/hot?type=boardgame`, BROWSE_BUDGET_MS);
  if (!xml) return [];
  const rows = items(xml).map((i) => ({
    id: attr(i.attrs, "id"),
    name: valueOf(i.body, "name"),
    year: valueOf(i.body, "yearpublished"),
    thumbnail: valueOf(i.body, "thumbnail"),
  })).filter((r) => r.id && r.name).slice(0, limit);
  // The hot list carries a thumbnail only; a card wants the box art and the rating.
  const full = new Map((await getBggThings(rows.map((r) => r.id as string))).map((t) => [t.id, t]));
  return rows.map((r) => {
    const t = full.get(r.id as string);
    return t ? thingCard(t) : {
      source: "bgg" as const, sourceId: r.id as string, type: "boardgame" as const, title: r.name as string,
      releaseDate: r.year, posterUrl: r.thumbnail, votes: 0, rating: null,
    };
  });
}
