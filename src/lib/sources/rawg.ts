const BASE = "https://api.rawg.io/api";
const KEY = process.env.RAWG_API_KEY!;

async function rawgGet(endpoint: string, params: Record<string, string> = {}) {
  const p = new URLSearchParams({ key: KEY, ...params });
  const res = await fetch(`${BASE}${endpoint}?${p}`);
  if (!res.ok) throw new Error(`RAWG error: ${res.status} ${endpoint}`);
  return res.json();
}

export async function searchRawg(query: string, page = 1) {
  return rawgGet("/games", { search: query, page_size: "10", page: String(page), search_precise: "true" });
}

export async function getRawgGame(id: number) {
  return rawgGet(`/games/${id}`);
}

// Login – returns { key: token, slug: userSlug }
export async function rawgLogin(email: string, password: string): Promise<{ token: string; slug: string }> {
  // Step 1: authenticate to get token
  const loginRes = await fetch(`${BASE}/auth/login`, {
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
  const profileRes = await fetch(`${BASE}/users/current`, {
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
    const fetchRes: Response = await fetch(url);
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
    const fetchRes: Response = await fetch(url, {
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

// Write-back: add game to RAWG "Want to Play"
export async function addToRawgToPlay(token: string, gameId: number) {
  const res = await fetch(`${BASE}/users/current/games`, {
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
  const res = await fetch(`${BASE}/users/current/games/${gameId}`, {
    method: "DELETE",
    headers: { "Token": `Token ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to remove from RAWG: ${res.status}`);
}
