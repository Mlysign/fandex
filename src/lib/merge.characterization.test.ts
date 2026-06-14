import { describe, it, expect } from "vitest";
import { mergeLinks, explainMerge, mergeForCanonical } from "./merge";
import { MediaLink, Source } from "@/types";

// Characterization snapshot of the FULL merge output. merge.ts's ~40 detail
// fields had no coverage; this captures current behavior so the A1 inversion
// (per-source normalizers → priority merge) is provably behavior-preserving —
// the snapshots below must stay byte-identical across the refactor.

const link = (source: Source, sourceId: string, rawData: any): MediaLink => ({
  id: `l-${source}`, mediaItemId: "m1", source, sourceId,
  title: rawData.title ?? rawData.name ?? null, releaseDate: null, rawData, lastSynced: 0,
});

// ── Rich movie fixtures (tmdb + trakt + letterboxd) ───────────────────────────
const tmdbMovie = {
  id: 27205, title: "Inception", overview: "A thief who steals corporate secrets through dream-sharing technology.",
  tagline: "Your mind is the scene of the crime.", release_date: "2010-07-16",
  poster_path: "/inception.jpg", backdrop_path: "/inception_bd.jpg", runtime: 148,
  status: "Released", budget: 160000000, revenue: 829895144,
  original_language: "en", spoken_languages: [{ iso_639_1: "en", english_name: "English" }],
  production_countries: [{ name: "United States of America" }],
  vote_average: 8.4, vote_count: 34000,
  genres: [{ name: "Action" }, { name: "Science Fiction" }],
  belongs_to_collection: { name: "Inception Collection" },
  homepage: "https://inception.movie",
  external_ids: { imdb_id: "tt1375666" },
  credits: {
    crew: [{ job: "Director", name: "Christopher Nolan" }],
    cast: [{ name: "Leonardo DiCaprio", character: "Cobb" }, { name: "Elliot Page", character: "Ariadne" }],
  },
  keywords: { keywords: [{ name: "dream" }, { name: "heist" }] },
  release_dates: { results: [
    { iso_3166_1: "DE", release_dates: [{ certification: "12" }] },
    { iso_3166_1: "US", release_dates: [{ certification: "PG-13" }] },
  ] },
  videos: { results: [{ site: "YouTube", type: "Trailer", official: true, key: "YoHD9XEInc0" }] },
  "watch/providers": { results: { DE: { flatrate: [{ provider_name: "Netflix", logo_path: "/nf.jpg", provider_id: 8 }] } } },
};
const traktMovie = {
  title: "Inception", overview: "A thief steals secrets via dreams.", tagline: "The dream is real.",
  released: "2010-07-15", runtime: 148, rating: 8.1, votes: 50000,
  certification: "PG-13", status: "released", language: "en", country: "us",
  genres: ["science-fiction", "action"], homepage: "https://trakt.tv/inception",
  ids: { trakt: 16662, slug: "inception-2010", imdb: "tt1375666", tmdb: 27205 },
  trailer: "https://youtube.com/watch?v=YoHD9XEInc0",
  social_ids: { wikipedia: "Inception" },
};
const letterboxdMovie = {
  id: "inception", name: "Inception", description: "Dom Cobb is a skilled thief.",
  tagline: "Your mind is the scene of the crime.", releaseYear: 2010, runTime: 148,
  averageRating: 4.2, genres: [{ name: "Thriller" }],
  directors: [{ name: "Christopher Nolan" }],
  posterUrl: "https://letterboxd.com/inception.jpg",
  links: [{ type: "imdb", url: "https://imdb.com/title/tt1375666" }, { type: "tmdb", id: 27205 }],
};

// ── Rich game fixtures (steam + rawg + igdb) ──────────────────────────────────
const steamGame = {
  appid: 1091500, name: "Cyberpunk 2077",
  basic_info: { short_description: "An open-world action-adventure RPG.", developers: [{ name: "CD Projekt Red" }], publishers: [{ name: "CD Projekt" }] },
  release: { steam_release_date: 1607558400 },
  platforms: { windows: true, mac: false, linux: false },
  resolvedTags: ["RPG", "Open World", "Cyberpunk"],
  reviews: { summary_filtered: { review_score_label: "Very Positive", percent_positive: 85, review_count: 600000 } },
  game_rating: { type: "usk", rating: "18" },
  assets: { asset_url_format: "apps/1091500/${FILENAME}", hero_capsule: "hero.jpg" },
  screenshots: { all_ages_screenshots: [{ filename: "apps/1091500/ss1.jpg" }] },
  included_items: { included_apps: [{ name: "Phantom Liberty" }] },
  trailers: { highlights: [{ id: 1 }] },
};
const rawgGame = {
  id: 41494, slug: "cyberpunk-2077", name: "Cyberpunk 2077",
  description_raw: "Cyberpunk 2077 is an open-world, action-adventure story set in Night City.",
  released: "2020-12-10", background_image: "https://rawg.io/cp2077.jpg",
  background_image_additional: "https://rawg.io/cp2077_2.jpg",
  metacritic: 86, metacritic_url: "https://metacritic.com/cyberpunk",
  rating: 4.1, ratings_count: 5000, playtime: 25,
  genres: [{ name: "RPG" }, { name: "Action" }],
  platforms: [{ platform: { name: "PC" } }, { platform: { name: "PlayStation 5" } }],
  esrb_rating: { name: "Mature" },
  stores: [{ store: { name: "Steam" }, url: "https://store.steampowered.com/app/1091500" }],
  website: "https://cyberpunk.net", reddit_url: "https://reddit.com/r/cyberpunkgame",
  short_screenshots: [{ image: "https://rawg.io/cp2077_ss.jpg" }],
};
const igdbGame = {
  id: 1877, name: "Cyberpunk 2077", summary: "Cyberpunk 2077 is an RPG set in Night City.",
  first_release_date: 1607558400, rating: 84, rating_count: 2000,
  aggregated_rating: 87, aggregated_rating_count: 50,
  cover: { image_id: "co2mjs" },
  genres: [{ name: "Role-playing (RPG)" }], themes: [{ name: "Science fiction" }],
  platforms: [{ name: "PC (Microsoft Windows)" }],
  game_modes: [{ name: "Single player" }], player_perspectives: [{ name: "First person" }],
  involved_companies: [{ developer: true, company: { name: "CD Projekt Red" } }, { publisher: true, company: { name: "CD Projekt" } }],
  franchises: [{ name: "Cyberpunk" }],
  dlcs: [{ name: "Phantom Liberty" }], expansions: [],
  time_to_beat: { hastily: 86400, normally: 144000, completely: 360000 },
  screenshots: [{ image_id: "sc1" }], artworks: [{ image_id: "ar1" }],
  videos: [{ name: "Trailer", video_id: "8X2kIfS6fb8" }],
  url: "https://igdb.com/games/cyberpunk-2077",
  websites: [{ type: 13, url: "https://store.steampowered.com/app/1091500" }, { type: 1, url: "https://cyberpunk.net" }],
};

// ── Show fixture (tmdb + trakt) ───────────────────────────────────────────────
const tmdbShow = {
  id: 1396, name: "Breaking Bad", overview: "A chemistry teacher turns to making meth.",
  first_air_date: "2008-01-20", poster_path: "/bb.jpg", status: "Ended",
  number_of_seasons: 5, number_of_episodes: 62,
  episode_run_time: [47], original_language: "en",
  networks: [{ name: "AMC" }], created_by: [{ name: "Vince Gilligan" }],
  genres: [{ name: "Drama" }], vote_average: 8.9, vote_count: 12000,
  content_ratings: { results: [{ iso_3166_1: "US", rating: "TV-MA" }] },
  next_episode_to_air: null,
};
const traktShow = {
  title: "Breaking Bad", overview: "A teacher cooks meth.", first_aired: "2008-01-20T02:00:00Z",
  runtime: 47, status: "ended", network: "AMC", rating: 9.0, votes: 30000,
  genres: ["drama"], country: "us", language: "en",
  ids: { trakt: 1, slug: "breaking-bad", imdb: "tt0903747", tmdb: 1396 },
};

describe("mergeLinks characterization", () => {
  it("movie: tmdb + trakt + letterboxd", () => {
    expect(mergeLinks([link("tmdb", "27205", tmdbMovie), link("trakt", "16662", traktMovie), link("letterboxd", "inception", letterboxdMovie)], "movie"))
      .toMatchSnapshot();
  });
  it("game: steam + rawg + igdb", () => {
    expect(mergeLinks([link("steam", "1091500", steamGame), link("rawg", "41494", rawgGame), link("igdb", "1877", igdbGame)], "game"))
      .toMatchSnapshot();
  });
  it("show: tmdb + trakt", () => {
    expect(mergeLinks([link("tmdb", "1396", tmdbShow), link("trakt", "1", traktShow)], "show"))
      .toMatchSnapshot();
  });
});

describe("explainMerge characterization", () => {
  it("movie debug matrix", () => {
    expect(explainMerge([link("tmdb", "27205", tmdbMovie), link("trakt", "16662", traktMovie), link("letterboxd", "inception", letterboxdMovie)], "movie"))
      .toMatchSnapshot();
  });
  it("game debug matrix", () => {
    expect(explainMerge([link("steam", "1091500", steamGame), link("rawg", "41494", rawgGame), link("igdb", "1877", igdbGame)], "game"))
      .toMatchSnapshot();
  });
});

describe("mergeForCanonical characterization", () => {
  it("movie canonical", () => {
    expect(mergeForCanonical([{ source: "tmdb", data: tmdbMovie }, { source: "trakt", data: traktMovie }, { source: "letterboxd", data: letterboxdMovie }]))
      .toMatchSnapshot();
  });
  it("game canonical", () => {
    expect(mergeForCanonical([{ source: "steam", data: steamGame }, { source: "rawg", data: rawgGame }, { source: "igdb", data: igdbGame }]))
      .toMatchSnapshot();
  });
});
