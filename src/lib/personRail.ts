// The shape and the label map for Home's "Popular people" rail.
//
// ⚠️ THIS FILE HAS NO IMPORTS, AND THAT IS THE ENTIRE REASON IT EXISTS.
//
// `roleLabel` started out in popularPeople.ts next to the code that ranks
// people. `PersonCard` imported it, `HomePageClient` (a client component)
// imports `PersonCard`, and Turbopack therefore followed
//
//   PersonCard -> popularPeople -> db.ts -> better-sqlite3
//
// into the BROWSER bundle, where the build died on `Can't resolve 'fs'`. The
// homepage returned a 500 with `tsc`, `npm run lint` and 1,019 tests all green,
// because nothing but actually loading the page exercises the client/server
// module graph.
//
// So: anything a client component needs from the people rail lives here, and
// popularPeople.ts (which reads the database) imports it rather than the other
// way round. Do not add an import to this file, and do not move `roleLabel`
// back "next to its data" for tidiness.

export interface PopularPerson {
  /** The normalized person key: the facet identity, and the slug's source. */
  key: string;
  /** First-seen display label ("Guillermo del Toro"). */
  name: string;
  /** `/person/{slug}`, ready to render as an href. */
  href: string;
  /** Absolute TMDB portrait url, or null. The rail renders initials for null. */
  portraitUrl: string | null;
  /** How many pool titles carry this person. Shown as the card's subtitle. */
  titleCount: number;
  /** The role they carry most, for the card's subtitle ("Director", "Actor"). */
  topRole: string;
  /** Ranking score. Exposed for the probe and the tests, not for display. */
  score: number;
}

/**
 * Human label for a role, for the card's subtitle.
 *
 * Falls back to the role id rather than a flat "Person": a role named after
 * itself still tells you which one it is. Same reasoning as the tag categories
 * in FandexScoreSection.
 */
export function roleLabel(role: string): string {
  switch (role) {
    case "director": return "Director";
    case "writer": return "Writer";
    case "creator": return "Creator";
    case "cast": return "Actor";
    default: return role.charAt(0).toUpperCase() + role.slice(1);
  }
}
