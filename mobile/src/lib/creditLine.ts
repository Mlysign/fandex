// What a title's card says under its name on a person's or a studio's page:
// the part they had in it (Nils, 2026-10-17: "a person's items should show
// what the role of that person was on that item"). Pure, so the website's
// build writes the same line on a static facet page.

/** The catalog's facet roles, in words. */
export const ROLE_LABEL: Record<string, string> = {
  director: 'Director', creator: 'Creator', writer: 'Writer', cast: 'Cast',
  developer: 'Developer', publisher: 'Publisher', studio: 'Studio', network: 'Network',
};

/** Who made it before who was in it; a studio's roles after a person's. */
const ORDER = ['director', 'creator', 'writer', 'cast', 'developer', 'publisher', 'studio', 'network'];

/** "creator" is the one role shared across media: a show's creator, a book's author, a board game's designer. */
function label(type: string, role: string): string {
  if (role === 'creator') return type === 'book' ? 'Author' : type === 'boardgame' ? 'Designer' : 'Creator';
  return ROLE_LABEL[role] ?? role;
}

/** The roles a title's facets file somebody under, as one line: "Director · Writer", "Author", "Publisher". Null for none. */
export function creditLine(type: string, roles: (string | undefined | null)[]): string | null {
  const had = [...new Set(roles.filter((r): r is string => !!r))]
    .sort((a, b) => ((ORDER.indexOf(a) + 1) || 99) - ((ORDER.indexOf(b) + 1) || 99));
  return had.length ? had.map((r) => label(type, r)).join(' · ') : null;
}

/** A TMDB crew job as a catalog role: the jobs the catalog files a person under (src/lib/facets.ts) and nothing finer. */
export function tmdbRole(job: string | null | undefined): string {
  return job === 'Director' ? 'director' : job === 'Creator' ? 'creator' : 'writer';
}

/** A credit with the parts played: "Director · as Tony Stark", "as Rachel, Dr. Grey", or the roles alone. */
export function creditWithParts(type: string, roles: string[], characters: string[]): string | null {
  const parts = [...new Set(characters.map((c) => c.trim()).filter(Boolean))];
  const line = [creditLine(type, roles), parts.length ? `as ${parts.join(', ')}` : null].filter(Boolean).join(' · ');
  return line || null;
}
