import { env as rawEnv } from "cloudflare:workers";
import type { Env } from "../src/env";

// The real bindings, minus the rate limiters: a suite that makes forty sign-in
// calls from one "IP" would otherwise start failing the day a test is added.
// The limiter wiring has its own test, with a fake.
export const env = {
  ...(rawEnv as unknown as Env),
  RL_RESOLVE: undefined,
  RL_AUTH: undefined,
  RL_WRITE: undefined,
} as Env;
export const db = env.DB;

/**
 * Empty every table. The suite does not rely on the pool's storage isolation:
 * a test that says what it starts from is one that still passes when that
 * mechanism changes.
 */
export async function wipe(): Promise<void> {
  const tables = await db
    .prepare(
      `SELECT name FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'`,
    )
    .all<{ name: string }>();
  // Children before parents is not needed: the deletes cascade, and a table
  // already emptied by a cascade deletes zero rows.
  await db.batch(tables.results.map((t) => db.prepare(`DELETE FROM "${t.name}"`)));
}

export async function count(table: string, where = "1 = 1", params: unknown[] = []): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) n FROM "${table}" WHERE ${where}`).bind(...params).first<{ n: number }>();
  return row?.n ?? 0;
}

// ── Provider payloads, cut down to the fields the pipeline reads ─────────────

export function tmdbMovie(over: Record<string, unknown> = {}): any {
  return {
    id: 603,
    title: "The Matrix",
    release_date: "1999-03-31",
    overview: "A computer hacker learns the truth about his reality.",
    poster_path: "/matrix.jpg",
    backdrop_path: "/matrix-backdrop.jpg",
    runtime: 136,
    vote_average: 8.2,
    vote_count: 25000,
    genres: [{ id: 28, name: "Action" }, { id: 878, name: "Science Fiction" }],
    keywords: { keywords: [{ id: 1, name: "dystopia" }, { id: 2, name: "hacker" }] },
    credits: {
      cast: [{ name: "Keanu Reeves", character: "Neo" }, { name: "Carrie-Anne Moss", character: "Trinity" }],
      crew: [{ job: "Director", name: "Lana Wachowski" }, { job: "Screenplay", name: "Lilly Wachowski" }],
    },
    production_companies: [{ name: "Warner Bros. Pictures" }],
    belongs_to_collection: { id: 2344, name: "The Matrix Collection" },
    external_ids: { imdb_id: "tt0133093" },
    ...over,
  };
}

export function tmdbShow(over: Record<string, unknown> = {}): any {
  return {
    id: 603,
    name: "Deadwood",
    first_air_date: "2004-03-21",
    overview: "A lawless town in the Black Hills.",
    poster_path: "/deadwood.jpg",
    vote_average: 8.1,
    vote_count: 900,
    genres: [{ id: 37, name: "Western" }],
    created_by: [{ name: "David Milch" }],
    networks: [{ name: "HBO" }],
    credits: { cast: [{ name: "Timothy Olyphant", character: "Seth Bullock" }], crew: [] },
    ...over,
  };
}

export function igdbGame(over: Record<string, unknown> = {}): any {
  return {
    id: 1942,
    name: "The Witcher 3: Wild Hunt",
    first_release_date: 1431993600, // 2015-05-19
    summary: "A monster hunter searches for his adopted daughter.",
    cover: { image_id: "co1wyy" },
    total_rating: 93.5,
    total_rating_count: 4200,
    genres: [{ name: "Role-playing (RPG)" }],
    themes: [{ name: "Fantasy" }],
    franchises: [{ name: "The Witcher" }],
    involved_companies: [{ developer: true, publisher: false, company: { name: "CD Projekt RED" } }],
    platforms: [{ name: "PC (Microsoft Windows)" }],
    ...over,
  };
}

export const movieItem = (over: Record<string, unknown> = {}) => {
  const d = tmdbMovie(over);
  return { source: "tmdb" as const, sourceId: String(d.id), type: "movie" as const, title: d.title, releaseDate: d.release_date ?? null, rawData: d };
};

export const showItem = (over: Record<string, unknown> = {}) => {
  const d = tmdbShow(over);
  return { source: "tmdb" as const, sourceId: String(d.id), type: "show" as const, title: d.name, releaseDate: d.first_air_date ?? null, rawData: d };
};

export const gameItem = (over: Record<string, unknown> = {}) => {
  const d = igdbGame(over);
  return { source: "igdb" as const, sourceId: String(d.id), type: "game" as const, title: d.name, releaseDate: "2015-05-19", rawData: d };
};
