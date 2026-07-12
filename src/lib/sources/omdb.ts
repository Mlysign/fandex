import { httpFetch } from "@/lib/http";

const API_KEY = process.env.OMDB_API_KEY!;

export interface OmdbResult {
  imdbID: string | null;
  imdbRating: number | null;
  imdbVotes: number | null;
  rtScore: number | null;
  metascore: number | null;
  rated: string | null;       // certification, e.g. "PG-13" / "TV-MA"
  awards: string | null;      // e.g. "Won 2 Oscars. 173 wins & 295 nominations"
  boxOffice: string | null;   // e.g. "$282,144,358"
  totalSeasons: number | null;
}

const EMPTY: OmdbResult = {
  imdbID: null, imdbRating: null, imdbVotes: null, rtScore: null,
  metascore: null, rated: null, awards: null, boxOffice: null, totalSeasons: null,
};

const val = (v: any): string | null => (v && v !== "N/A" ? String(v) : null);
const num = (v: any): number | null => {
  const n = parseFloat(String(v ?? "").replace(/[,%]/g, ""));
  return isNaN(n) ? null : n;
};

function parse(data: any): OmdbResult {
  const rt = (data.Ratings ?? []).find((r: any) => r.Source === "Rotten Tomatoes");
  return {
    imdbID: data.imdbID ?? null,
    imdbRating: num(val(data.imdbRating)),
    imdbVotes: num(val(data.imdbVotes)),
    rtScore: num(val(rt?.Value)),
    metascore: num(val(data.Metascore)),
    rated: val(data.Rated),
    awards: val(data.Awards),
    boxOffice: val(data.BoxOffice),
    totalSeasons: num(val(data.totalSeasons)),
  };
}

async function omdbGet(params: Record<string, string>): Promise<OmdbResult> {
  if (!API_KEY) return EMPTY;
  try {
    const p = new URLSearchParams({ apikey: API_KEY, ...params });
    const res = await httpFetch(`https://www.omdbapi.com/?${p}`);
    if (!res.ok) return EMPTY;
    const data = await res.json();
    if (data.Response === "False") return EMPTY;
    return parse(data);
  } catch {
    return EMPTY;
  }
}

// Exact lookup by IMDb id — preferred when TMDB/Trakt already gave us one.
export async function fetchOmdbByImdbId(imdbId: string): Promise<OmdbResult> {
  return omdbGet({ i: imdbId });
}

// Title-search fallback. `type` matters: shows must query type=series.
export async function fetchOmdbScores(
  title: string,
  year?: number,
  type: "movie" | "series" = "movie"
): Promise<OmdbResult> {
  const params: Record<string, string> = { t: title, type };
  if (year) params.y = String(year);
  return omdbGet(params);
}
