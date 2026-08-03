import Link from "next/link";
import type { LegalLocale } from "@/lib/legal/types";
import SupportLink from "@/components/legal/SupportLink";

// The ONE list of legal links, and the ONE place their tap-target/wrap handling
// lives. Rendered by `LegalFooter` (bottom of /profile) and by `SignInDialog`.
//
// Why the dialog too (2026-08-02): H4.10's compliance review found that an
// ANONYMOUS visitor could not reach any `/legal/*` page through the UI at all.
// H4.1 had reasoned that /profile's footer satisfies the BGH two-click rule
// because "H1's nav already guarantees /profile is reachable from everywhere" —
// true for a logged-in visitor, false for an anonymous one: `AppNav`'s "You"
// slot renders as a BUTTON that opens this dialog when `authed === false`, and
// `ProfilePageClient` additionally `router.replace("/")`s an anon visitor before
// the footer ever renders even on a direct URL hit. So the dialog is not an odd
// place for these — it is precisely where the anonymous nav path terminates,
// which makes the chain nav → "You" → dialog → link a real two clicks.
//
// Defaults to the "en" locale, same as the footer; locale detection is out of
// scope here (H4.1's decision, unchanged).
// Labels per locale. H4.1 left locale detection out of scope and hardcoded
// "en", which was invisible while this only rendered on /profile and in the
// sign-in dialog. Putting the footer on the legal pages themselves (2026-08-03)
// made it obvious and wrong: standing on /legal/de/imprint, every footer link
// threw you back into English. There is still no locale DETECTION — the caller
// passes the locale it already knows, and everywhere else keeps defaulting to
// "en" exactly as before.
const LINKS: Record<LegalLocale, { href: string; label: string }[]> = {
  en: [
    { href: "/legal/en/privacy", label: "Privacy" },
    { href: "/legal/en/terms", label: "Terms" },
    // "Contact", not "Support" (2026-08-03). The doc's own title is still
    // "Support" — this is only its label in the nav. Once the donations link
    // became a prominent "Support Fandex" pill sitting right above this row,
    // two adjacent things called "Support" meant completely different things:
    // one is where you get help, the other is where you give money. "Contact"
    // describes what the page is (an email address and what to expect) and
    // collides with nothing.
    { href: "/legal/en/support", label: "Contact" },
    { href: "/legal/en/imprint", label: "Imprint" },
  ],
  de: [
    { href: "/legal/de/privacy", label: "Datenschutz" },
    { href: "/legal/de/terms", label: "AGB" },
    { href: "/legal/de/support", label: "Kontakt" },
    { href: "/legal/de/imprint", label: "Impressum" },
  ],
};

export default function LegalLinks({
  className = "",
  onNavigate,
  locale = "en",
}: {
  className?: string;
  /** Which locale's docs to link to. Defaults to "en", H4.1's original behaviour. */
  locale?: LegalLocale;
  /**
   * Called when a link is followed. Exists for the dialog: `AppNav` lives in the
   * root layout and never unmounts, so its `showSignIn` state OUTLIVES a
   * client-side route change — tapping "Imprint" landed on /legal/en/imprint
   * with the full-screen dialog still covering it at z-index 110 (verified
   * 2026-08-02, before this). Closing at the point of navigation rather than in
   * a route-watching effect keeps the causality explicit and avoids a
   * setState-in-effect cascading render, which is an eslint ERROR in this repo.
   */
  onNavigate?: () => void;
}) {
  return (
    <>
      {/* H3.3 — the donations link sits ABOVE this row, not in it (2026-08-03).
          It was a fifth entry here, styled identically to Privacy/Terms/Imprint,
          which made a voluntary ask look like another legal obligation and
          buried it completely. `SupportLink` owns its own presentation and its
          own 44px target, so the wrapped-row overlap fix below still only has
          to reason about the legal links. Renders nothing when the url is
          unset. */}
      <SupportLink locale={locale} onNavigate={onNavigate} className="mb-6" />

      {/* SM33 (2026-07-30, fixed 2026-07-31): the four links measured ~45×16 at
          375px. `.tap-44-y` expands each to a 44px hit height, but that alone
          isn't enough — this row WRAPS, and two 16px-tall links in adjacent
          wrapped rows each expanding to 44px extend 14px beyond their own box
          top and bottom, so the old `gap-y-2` (8px) let neighbouring rows'
          expanded hit areas overlap and steal each other's taps — worse than
          the small target being fixed. `gap-y-8` (32px) keeps every pair's
          expanded 44px boxes clear. Kept here rather than at each call site so
          a second consumer can't reintroduce it.

          These `//` lines were a plain JS comment before the surrounding
          fragment existed, which was fine: a comment sitting in `return ( … )`
          ahead of the root element is JS, not JSX. Wrapping the return in a
          fragment silently moved them into JSX CHILDREN position, where `//`
          is not a comment at all — it's a text node, and the whole paragraph
          rendered into the footer. Nothing caught it: tsc, tests and lint all
          passed, because it is valid JSX. `react/jsx-no-comment-textnodes` is
          now an error in eslint.config.mjs so the next one fails the build. */}
      <nav
      className={`flex flex-wrap gap-x-4 gap-y-8 justify-center text-xs font-mono text-text-secondary ${className}`}
      aria-label="Legal"
    >
      {LINKS[locale].map((l) => (
        <Link
          key={l.href}
          href={l.href}
          onClick={onNavigate}
          className="tap-44-y hover:text-text-primary transition-colors"
        >
          {l.label}
        </Link>
      ))}
    </nav>
    </>
  );
}
