// One-off API investigation: probe every metadata source with maximally
// extended requests and dump the shape of what comes back. Run with:
//   node scripts/probe-apis.mjs [tmdb|trakt|rawg|steam|igdb|omdb|letterboxd|all]
import { readFileSync } from "fs";
import { createHmac, randomBytes } from "crypto";

// ── env ──
const env = {};
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

const only = process.argv[2] ?? "all";
const want = (n) => only === "all" || only === n;

// Print helper: shows structure without flooding output.
function shape(v, depth = 0, maxDepth = 3) {
  if (v === null) return "null";
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    return `[${v.length}× ${shape(v[0], depth + 1, maxDepth)}]`;
  }
  if (typeof v === "object") {
    if (depth >= maxDepth) return "{…}";
    const entries = Object.entries(v).map(([k, x]) => `${k}: ${shape(x, depth + 1, maxDepth)}`);
    return `{ ${entries.join(", ")} }`;
  }
  if (typeof v === "string") return JSON.stringify(v.length > 60 ? v.slice(0, 60) + "…" : v);
  return String(v);
}

function dump(label, obj, keys) {
  console.log(`\n──── ${label} ────`);
  if (!obj) { console.log("  (null)"); return; }
  for (const k of keys ?? Object.keys(obj)) {
    if (obj[k] === undefined) { console.log(`  ${k}: <missing>`); continue; }
    console.log(`  ${k}: ${shape(obj[k])}`);
  }
}

// ── TMDB ──
async function tmdb() {
  const get = async (path, params = {}) => {
    const p = new URLSearchParams({ api_key: env.TMDB_API_KEY, ...params });
    const r = await fetch(`https://api.themoviedb.org/3${path}?${p}`);
    console.log(`TMDB ${path} → ${r.status}`);
    return r.ok ? r.json() : null;
  };
  const movie = await get("/movie/693134", {
    append_to_response: "videos,credits,watch/providers,keywords,release_dates,external_ids,images,recommendations",
    include_image_language: "en,null",
  });
  dump("TMDB movie (Dune: Part Two) — full keys", movie);
  if (movie) {
    dump("TMDB movie release_dates.results[DE/US]", {
      DE: movie.release_dates?.results?.find((r) => r.iso_3166_1 === "DE"),
      US: movie.release_dates?.results?.find((r) => r.iso_3166_1 === "US"),
    });
    dump("TMDB movie external_ids", movie.external_ids);
    console.log("  collection:", shape(movie.belongs_to_collection));
  }
  const show = await get("/tv/1396", {
    append_to_response: "videos,credits,aggregate_credits,watch/providers,keywords,content_ratings,external_ids,images,recommendations",
  });
  dump("TMDB show (Breaking Bad) — full keys", show);
  if (show) {
    dump("TMDB show extras", {
      content_ratings_DE_US: show.content_ratings?.results?.filter((r) => ["DE", "US"].includes(r.iso_3166_1)),
      networks: show.networks,
      next_episode_to_air: show.next_episode_to_air,
      last_episode_to_air: show.last_episode_to_air,
      seasons: show.seasons?.slice(0, 2),
      external_ids: show.external_ids,
    });
  }
}

// ── Trakt (public, no user token) ──
async function trakt() {
  const HEADERS = {
    "Content-Type": "application/json",
    "trakt-api-version": "2",
    "trakt-api-key": env.TRAKT_CLIENT_ID,
    "User-Agent": "ReleaseRadar/2.0",
  };
  const get = async (path) => {
    const r = await fetch(`https://api.trakt.tv${path}`, { headers: HEADERS });
    console.log(`Trakt ${path} → ${r.status}`);
    return r.ok ? r.json() : null;
  };
  dump("Trakt movie extended=full (public)", await get("/movies/dune-part-two-2024?extended=full"));
  dump("Trakt show extended=full (public)", await get("/shows/breaking-bad?extended=full"));
  dump("Trakt search by tmdb id (public)", (await get("/search/tmdb/693134?type=movie"))?.[0]);
  const ratings = await get("/movies/dune-part-two-2024/ratings");
  dump("Trakt movie ratings dist", ratings);
}

// ── RAWG ──
async function rawg() {
  const get = async (path, params = {}) => {
    const p = new URLSearchParams({ key: env.RAWG_API_KEY, ...params });
    const r = await fetch(`https://api.rawg.io/api${path}?${p}`);
    console.log(`RAWG ${path} → ${r.status}`);
    return r.ok ? r.json() : null;
  };
  const search = await get("/games", { search: "Elden Ring", page_size: "1", search_precise: "true" });
  const id = search?.results?.[0]?.id;
  console.log("RAWG Elden Ring id:", id);
  const game = await get(`/games/${id}`);
  dump("RAWG game detail — full keys", game);
  if (game) {
    dump("RAWG selected", {
      esrb_rating: game.esrb_rating,
      ratings: game.ratings,
      rating: game.rating,
      ratings_count: game.ratings_count,
      playtime: game.playtime,
      website: game.website,
      reddit_url: game.reddit_url,
      metacritic_url: game.metacritic_url,
      metacritic_platforms: game.metacritic_platforms,
      alternative_names: game.alternative_names,
      tags: game.tags?.slice(0, 3),
    });
  }
  dump("RAWG /movies (trailers)", await get(`/games/${id}/movies`));
  dump("RAWG /screenshots", await get(`/games/${id}/screenshots`, { page_size: "3" }));
  dump("RAWG /game-series", await get(`/games/${id}/game-series`, { page_size: "3" }));
  dump("RAWG /additions (DLC)", await get(`/games/${id}/additions`, { page_size: "3" }));
  dump("RAWG /achievements", await get(`/games/${id}/achievements`, { page_size: "2" }));
}

// ── Steam ──
async function steam() {
  const inputJson = JSON.stringify({
    ids: [{ appid: 1245620 }],
    context: { language: "english", country_code: "DE", steam_realm: 1 },
    data_request: {
      include_release: true,
      include_basic_info: true,
      include_short_description: true,
      include_full_description: true,
      include_platforms: true,
      include_screenshots: true,
      include_trailers: true,
      include_ratings: true,
      include_tag_count: 20,
      include_reviews: true,
      include_assets: true,
      include_supported_languages: true,
      include_links: true,
      include_included_items: true,
      include_all_purchase_options: true,
    },
  });
  const r = await fetch(
    `https://api.steampowered.com/IStoreBrowseService/GetItems/v1?key=${env.STEAM_API_KEY}&input_json=${encodeURIComponent(inputJson)}`
  );
  console.log(`Steam GetItems → ${r.status}`);
  const data = r.ok ? await r.json() : null;
  const item = data?.response?.store_items?.[0];
  dump("Steam store item (Elden Ring) — full keys", item);
  if (item) {
    dump("Steam selected", {
      basic_info: item.basic_info,
      ratings: item.ratings,
      reviews: item.reviews,
      supported_languages: item.supported_languages?.slice(0, 3),
      links: item.links,
      full_description: typeof item.full_description,
      best_purchase_option: item.best_purchase_option,
      categories: item.categories,
    });
  }
}

// ── IGDB ──
async function igdb() {
  const tok = await (await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${env.TWITCH_CLIENT_ID}&client_secret=${env.TWITCH_CLIENT_SECRET}&grant_type=client_credentials`,
    { method: "POST" }
  )).json();
  const q = async (endpoint, body) => {
    const r = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
      method: "POST",
      headers: { "Client-ID": env.TWITCH_CLIENT_ID, Authorization: `Bearer ${tok.access_token}`, "Content-Type": "text/plain", Accept: "application/json" },
      body,
    });
    console.log(`IGDB ${endpoint} → ${r.status}`);
    const j = await r.json();
    if (!r.ok) console.log("  error:", JSON.stringify(j).slice(0, 300));
    return r.ok ? j : null;
  };
  const fields =
    "fields name,slug,summary,storyline,first_release_date,url,status,hypes," +
    "rating,rating_count,aggregated_rating,aggregated_rating_count,total_rating,total_rating_count," +
    "cover.image_id,artworks.image_id,screenshots.image_id,videos.*," +
    "genres.name,themes.name,game_modes.name,player_perspectives.name,franchises.name," +
    "platforms.name,release_dates.*,release_dates.platform.name,age_ratings.*," +
    "alternative_names.name,dlcs.name,expansions.name,similar_games.name,similar_games.cover.image_id," +
    "websites.*,involved_companies.developer,involved_companies.publisher,involved_companies.company.name," +
    "multiplayer_modes.*,language_supports.language.name,game_engines.name,keywords.name;";
  const rows = await q("games", `search "Elden Ring"; ${fields} limit 1;`);
  const g = rows?.[0];
  dump("IGDB game (Elden Ring) — full keys", g);
  if (g) {
    dump("IGDB selected", {
      videos: g.videos?.slice(0, 2),
      release_dates: g.release_dates?.slice(0, 3),
      age_ratings: g.age_ratings?.slice(0, 3),
      websites: g.websites?.slice(0, 5),
      multiplayer_modes: g.multiplayer_modes,
    });
    dump("IGDB time_to_beat", (await q("game_time_to_beats", `fields *; where game_id = ${g.id};`))?.[0]);
  }
}

// ── OMDB ──
async function omdb() {
  const get = async (params) => {
    const p = new URLSearchParams({ apikey: env.OMDB_API_KEY, ...params });
    const r = await fetch(`https://www.omdbapi.com/?${p}`);
    console.log(`OMDB ${JSON.stringify(params)} → ${r.status}`);
    return r.ok ? r.json() : null;
  };
  dump("OMDB by imdb id (movie, full plot)", await get({ i: "tt15239678", plot: "full" }));
  dump("OMDB series (Breaking Bad)", await get({ i: "tt0903747" }));
}

// ── Letterboxd ──
async function letterboxd() {
  const API_BASE = "https://api.letterboxd.com/api/v0";
  const sign = (method, url, nonce, ts) =>
    createHmac("sha256", env.LETTERBOXD_API_SECRET)
      .update([env.LETTERBOXD_API_KEY, nonce, ts, method.toUpperCase(), url].join(" "))
      .digest("hex");
  const get = async (path, query = {}) => {
    const qs = new URLSearchParams(query).toString();
    const urlForSign = `${API_BASE}${path}${qs ? "?" + qs : ""}`;
    const nonce = randomBytes(12).toString("hex");
    const ts = Math.floor(Date.now() / 1000).toString();
    const finalQs = new URLSearchParams({ ...query, apikey: env.LETTERBOXD_API_KEY, nonce, timestamp: ts, signature: sign("GET", urlForSign, nonce, ts) }).toString();
    const r = await fetch(`${API_BASE}${path}?${finalQs}`);
    console.log(`Letterboxd ${path} → ${r.status}`);
    return r.ok ? r.json() : null;
  };
  const search = await get("/search", { input: "Dune Part Two", perPage: "1", include: "FilmSearchItem" });
  const film = search?.items?.[0]?.film;
  console.log("Letterboxd film id:", film?.id);
  if (film) {
    dump("Letterboxd film detail — full keys", await get(`/film/${film.id}`));
    dump("Letterboxd film statistics", await get(`/film/${film.id}/statistics`));
  }
}

const probes = { tmdb, trakt, rawg, steam, igdb, omdb, letterboxd };
for (const [name, fn] of Object.entries(probes)) {
  if (!want(name)) continue;
  try { await fn(); } catch (e) { console.log(`!! ${name} probe failed:`, e.message); }
}
