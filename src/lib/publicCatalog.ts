// The public catalog switch (2026-10-04). `PUBLIC_CATALOG=0` takes the crawlable
// surface off: robots.txt disallows everything but /legal/, the sitemap lists
// only the legal pages, and the item, facet and calendar pages send noindex.
// The pages still render for anyone who opens them; the switch is about what
// we INVITE crawlers to fetch, because that is what fills the facet cache and
// spends the TMDB budget. Decided with the move to an app + website on
// Cloudflare (docs/app-plan.md): the Next.js site is a private tool until then.
//
// Default ON, and read at CALL time, so a typo leaves the site as it was and a
// test can flip it without reloading the module (AGENTS.md: a gate read at
// module load is a gate nothing tests). Leaf module on purpose: robots.ts and
// three page files import it, and none of them may pull db.ts in.
export function publicCatalogEnabled(): boolean {
  const v = (process.env.PUBLIC_CATALOG ?? "").trim().toLowerCase();
  return !(v === "0" || v === "false" || v === "off");
}
