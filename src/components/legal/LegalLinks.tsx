import Link from "next/link";

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
const LINKS: { href: string; label: string }[] = [
  { href: "/legal/en/privacy", label: "Privacy" },
  { href: "/legal/en/terms", label: "Terms" },
  { href: "/legal/en/support", label: "Support" },
  { href: "/legal/en/imprint", label: "Imprint" },
];

export default function LegalLinks({
  className = "",
  onNavigate,
}: {
  className?: string;
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
    // SM33 (2026-07-30, fixed 2026-07-31): the four links measured ~45×16 at
    // 375px. `.tap-44-y` expands each to a 44px hit height, but that alone isn't
    // enough — this row WRAPS, and two 16px-tall links in adjacent wrapped rows
    // each expanding to 44px extend 14px beyond their own box top and bottom, so
    // the old `gap-y-2` (8px) let neighbouring rows' expanded hit areas overlap
    // and steal each other's taps — worse than the small target being fixed.
    // `gap-y-8` (32px) keeps every pair's expanded 44px boxes clear. Kept here
    // rather than at each call site so a second consumer can't reintroduce it.
    <nav
      className={`flex flex-wrap gap-x-4 gap-y-8 justify-center text-xs font-mono text-text-secondary ${className}`}
      aria-label="Legal"
    >
      {LINKS.map((l) => (
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
  );
}
