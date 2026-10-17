// BGG helpers with no imports, for the app and the facet code (sources/bgg.ts fetches).

/** BGG's 1-10 average on Fandex's 0-100. */
export function bggRating(average: number | null): number | null {
  return average != null && average > 0 ? Math.round(average * 10) : null;
}

/**
 * Families that are a franchise or a series ("Series: Catan", "Franchise: Star
 * Wars", "Game: Pandemic"), as the franchise's name. The rest of BGG's families
 * ("Theme: Pirates", "Mechanism: …", "Components: Miniatures", "Country: …")
 * are not one; "Theme:" ones become tags (`bggThemes`).
 */
export function bggFranchises(families: string[]): string[] {
  const out: string[] = [];
  for (const f of families) {
    const m = /^(Series|Franchise|Game|Video Game Theme|Movies?|TV Series|Books?|Comic Books?): (.+)$/i.exec(f);
    if (m) out.push(m[2].replace(/\s*\(.*\)\s*$/, "").trim());
  }
  return [...new Set(out)].filter(Boolean);
}

export function bggThemes(families: string[]): string[] {
  return families.map((f) => /^Theme: (.+)$/i.exec(f)?.[1]?.trim()).filter((t): t is string => !!t);
}
