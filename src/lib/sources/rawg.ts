import { httpFetch } from "@/lib/http";

const BASE = "https://api.rawg.io/api";
const KEY = process.env.RAWG_API_KEY!;

async function rawgGet(endpoint: string, params: Record<string, string> = {}) {
  const p = new URLSearchParams({ key: KEY, ...params });
  const res = await httpFetch(`${BASE}${endpoint}?${p}`);
  if (!res.ok) throw new Error(`RAWG error: ${res.status} ${endpoint}`);
  return res.json();
}

export async function searchRawg(query: string, page = 1) {
  return rawgGet("/games", { search: query, page_size: "10", page: String(page), search_precise: "true" });
}

// Game detail + screenshots + trailers + store URLs in one payload. The detail
// endpoint returns none of these directly: search results carry
// short_screenshots but detail doesn't, and detail's embedded `stores[]` have
// the store names but empty `url`s — the real per-store product URLs live on the
// /stores sub-endpoint (keyed by store_id). Fetch the sub-endpoints and attach.
export async function getRawgGame(id: number) {
  const [game, screenshots, movies, stores] = await Promise.all([
    rawgGet(`/games/${id}`),
    rawgGet(`/games/${id}/screenshots`, { page_size: "8" }).catch(() => null),
    rawgGet(`/games/${id}/movies`).catch(() => null),
    rawgGet(`/games/${id}/stores`).catch(() => null),
  ]);
  if (screenshots?.results?.length) game.screenshots = screenshots.results;
  if (movies?.results?.length) game.movies = movies.results;
  // Backfill the empty embedded store urls from the /stores sub-endpoint, matched
  // by store_id (Steam, PlayStation Store, Xbox, GOG, Epic, Nintendo, …).
  if (stores?.results?.length && Array.isArray(game?.stores)) {
    const urlByStore = new Map<number, string>(
      stores.results.filter((r: any) => r.url).map((r: any) => [r.store_id, r.url])
    );
    for (const s of game.stores) {
      if (!s.url && s.store?.id != null) s.url = urlByStore.get(s.store.id) ?? s.url;
    }
  }
  return game;
}

// Login – returns { key: token, slug: userSlug }
export async function rawgLogin(email: string, password: string): Promise<{ token: string; slug: string }> {
  // Step 1: authenticate to get token
  const loginRes = await httpFetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!loginRes.ok) {
    const body = await loginRes.text();
    throw new Error(`RAWG login failed: ${loginRes.status} ${body}`);
  }
  const loginData = await loginRes.json();
  const token = loginData.key;
  if (!token) throw new Error("RAWG login did not return a token");

  // Step 2: fetch user profile to get slug
  const profileRes = await httpFetch(`${BASE}/users/current`, {
    headers: {
      "Content-Type": "application/json",
      "Token": `Token ${token}`,
    },
  });
  let slug = email.split("@")[0]; // fallback
  if (profileRes.ok) {
    const profile = await profileRes.json();
    slug = profile.slug ?? profile.username ?? slug;
  }

  return { token, slug };
}

// Fetch user's "Want to Play" list using their slug (public endpoint)
export async function getRawgUserToPlay(slug: string): Promise<any[]> {
  const items: any[] = [];
  let url: string | null = `${BASE}/users/${encodeURIComponent(slug)}/games?key=${KEY}&statuses=toplay&page_size=40`;

  while (url) {
    const fetchRes: Response = await httpFetch(url);
    if (!fetchRes.ok) {
      if (fetchRes.status === 404) throw new Error(`RAWG user "${slug}" not found`);
      throw new Error(`RAWG API error: ${fetchRes.status}`);
    }
    const data: any = await fetchRes.json();
    items.push(...(data.results ?? []));
    url = data.next ?? null;
  }
  return items;
}

// Authenticated fetch using token + slug
export async function getRawgUserToPlayAuth(token: string, slug: string): Promise<any[]> {
  const items: any[] = [];
  let url: string | null = `${BASE}/users/${encodeURIComponent(slug)}/games?key=${KEY}&statuses=toplay&page_size=40`;

  while (url) {
    const fetchRes: Response = await httpFetch(url, {
      headers: { "Token": `Token ${token}` },
    });
    if (!fetchRes.ok) {
      if (fetchRes.status === 401) throw new Error("RAWG token invalid – please reconnect");
      throw new Error(`RAWG API error: ${fetchRes.status}`);
    }
    const data: any = await fetchRes.json();
    items.push(...(data.results ?? []));
    url = data.next ?? null;
  }
  return items;
}

// Fetch the user's played/owned games (everything except the "to play" wishlist).
// The status filter is applied server-side. Each game may carry the user's
// personal `user_game.rating` (1-5) when they have rated it.
const PLAYED_STATUSES = "owned,playing,beaten,dropped";

export async function getRawgUserPlayed(slug: string, token?: string): Promise<any[]> {
  const items: any[] = [];
  let url: string | null =
    `${BASE}/users/${encodeURIComponent(slug)}/games?key=${KEY}&statuses=${PLAYED_STATUSES}&page_size=40`;

  while (url) {
    const res: Response = await httpFetch(url, token ? { headers: { Token: `Token ${token}` } } : undefined);
    if (!res.ok) {
      if (res.status === 404) throw new Error(`RAWG user "${slug}" not found`);
      if (res.status === 401) throw new Error("RAWG token invalid – please reconnect");
      throw new Error(`RAWG API error: ${res.status}`);
    }
    const data: any = await res.json();
    items.push(...(data.results ?? []));
    url = data.next ?? null;
  }
  return items;
}

// Write-back: add game to RAWG "Want to Play"
export async function addToRawgToPlay(token: string, gameId: number) {
  const res = await httpFetch(`${BASE}/users/current/games`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Token": `Token ${token}` },
    body: JSON.stringify({ game: gameId, status: "toplay" }),
  });
  if (!res.ok) {
    const body = await res.text();
    // 400 "already in profile" is not a real error – game is already there
    if (res.status === 400 && body.includes("already in this profile")) {
      console.log(`[RAWG] Game ${gameId} already in Want to Play list`);
      return;
    }
    throw new Error(`Failed to add to RAWG: ${res.status} ${body}`);
  }
}

export async function removeFromRawgToPlay(token: string, gameId: number) {
  const res = await httpFetch(`${BASE}/users/current/games/${gameId}`, {
    method: "DELETE",
    headers: { "Token": `Token ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to remove from RAWG: ${res.status}`);
}

// Write-back: mark as beaten (played)
// Tries POST first; if the game is already in the profile, PATCHes to update status.
export async function markRawgBeaten(token: string, gameId: number): Promise<void> {
  const postRes = await httpFetch(BASE + "/users/current/games", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Token": "Token " + token },
    body: JSON.stringify({ game: gameId, status: "beaten" }),
  });
  if (postRes.ok) return;
  const text = await postRes.text();
  if (postRes.status === 400 && text.includes("already")) {
    const patchRes = await httpFetch(BASE + "/users/current/games/" + gameId, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Token": "Token " + token },
      body: JSON.stringify({ status: "beaten" }),
    });
    if (!patchRes.ok) throw new Error("RAWG PATCH status failed: " + patchRes.status);
    return;
  }
  throw new Error("RAWG mark beaten failed: " + postRes.status + " " + text);
}

// Map the app's 1-10 score to RAWG's discrete rating buckets. RAWG only accepts
// {1: skip, 3: meh, 4: recommended, 5: exceptional} — there is no "2". This is the
// inverse of the pull mapping (user_rating * 2) bucketed to the nearest valid value.
function appRatingToRawg(appRating: number): number {
  if (appRating >= 9) return 5;
  if (appRating >= 7) return 4;
  if (appRating >= 4) return 3;
  return 1;
}

// Write-back: rate a game (app scale 1-10 → RAWG scale 1/3/4/5).
//
// RAWG stores personal ratings as *reviews*, NOT on the "My games" library entry.
// PATCH/POST to /users/current/games returns 200 but silently ignores any `rating`
// field — so the rating must go through /reviews. We still ensure the game is in
// the library (best-effort) so it shows up under the user's played games, then
// POST the review. Re-POSTing /reviews for the same game updates the existing
// review in place (idempotent per user+game — no duplicates).
export async function rateRawgGame(token: string, gameId: number, appRating: number): Promise<void> {
  const rawgRating = appRatingToRawg(appRating);

  // 1. Best-effort: make sure the game is in the user's library. A 400 "already
  //    in this profile" is fine; any other failure here shouldn't block the rating.
  try {
    await httpFetch(BASE + "/users/current/games", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Token": "Token " + token },
      body: JSON.stringify({ game: gameId, status: "beaten" }),
    });
  } catch { /* non-fatal — the review below is what actually records the rating */ }

  // 2. Record the rating via the reviews endpoint (the mechanism RAWG honors).
  const res = await httpFetch(BASE + "/reviews", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Token": "Token " + token },
    body: JSON.stringify({ game: gameId, rating: rawgRating, is_text: false }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error("RAWG rate failed: " + res.status + " " + text);
  }
}
