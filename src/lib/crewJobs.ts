// TMDB crew jobs, in one place for the two modules that must agree on them:
// facets.ts reads them and sources/project.ts decides what a stored blob
// keeps. When the two lists drifted, the stored crew held four jobs and the
// facets asked for twelve, so no film carried its novelist: Stephen King had
// no writer facet on any film adapted from his books (found 2026-10-18).

/** Crew jobs that count as "writer". */
export const WRITER_JOBS = new Set([
  "Writer", "Screenplay", "Story", "Novel", "Author", "Comic Book",
  "Characters", "Teleplay", "Co-Writer", "Original Story",
]);

/** Every crew job a stored TMDB blob keeps: the directors and creators, and every writer. */
export const KEPT_CREW_JOBS = new Set(["Director", "Creator", ...WRITER_JOBS]);
