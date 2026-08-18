import { Globe } from "lucide-react";
import { BRAND_MARKS } from "@/lib/brandMarks";

// The one place a PLATFORM is drawn as itself (2026-08-18).
//
// Nils: "the login modal should drop the color coding of the platforms and
// instead use the platforms logos (the color coding can be removed everywhere on
// fandex (e.g. wishlist on details pages))."
//
// Before this, five surfaces identified a provider by painting a coloured dot or
// a tinted pill in its brand hex — the item page's per-source release dates, its
// per-platform rating chips, its community/critic score badges, the "Your
// wishlists" panel, and the settings account cards. Together that put a dozen
// unrelated saturated hues on two screens, which is the exact problem the H1 pass
// solved for facets (17 hues → 4 by class) and StoreLink solved for outbound
// links (brand tint → brand mark). This is the same answer, applied to the last
// places still doing it.
//
// COLOUR IS NEVER THE ONLY CARRIER — every call site here renders the provider's
// name in text beside the glyph, and did before, so nothing about this changes
// what the page means (06-accessibility.md). It removes redundant tint, not
// information. The glyph is `aria-hidden` for exactly that reason: the adjacent
// text is already the accessible name, and announcing "Steam Steam" is worse
// than announcing "Steam".
//
// Marks are inline SVG from lib/brandMarks (simple-icons, generated) because the
// CSP blocks every external host, so a remote favicon is not an option.

// `media_links.source` / provider ids are lowercase ("steam"); BRAND_MARKS is
// keyed by the display NAME normalize.ts emits ("Steam"). An explicit map rather
// than a case-insensitive lookup, so a source with no mark is a decision that
// shows up in a diff instead of a silent miss.
//
// Deliberately absent, all falling back to the globe: `rawg` (simple-icons has
// no RAWG icon), `rt` / `metacritic` (no icon either), and `igdb-critics` (the
// same IGDB mark would make it indistinguishable from plain `igdb`, and the two
// are different numbers on the same row).
const MARK_BY_SOURCE: Record<string, string> = {
  steam: "Steam",
  trakt: "Trakt",
  tmdb: "TMDB",
  igdb: "IGDB",
  imdb: "IMDb",
  gog: "GOG",
  epic: "Epic Games",
  itch: "itch.io",
  reddit: "Reddit",
  discord: "Discord",
  wikipedia: "Wikipedia",
};

export default function BrandGlyph({
  source, size = 14, className = "text-text-secondary",
}: {
  /** A lowercase source/provider id, or a BRAND_MARKS display name. */
  source: string;
  size?: number;
  /** Colour/extra classes. Defaults to the UI's own secondary text colour. */
  className?: string;
}) {
  const mark = BRAND_MARKS[MARK_BY_SOURCE[source] ?? source];
  if (!mark) {
    return <Globe style={{ width: size, height: size }} className={`shrink-0 ${className}`} aria-hidden />;
  }
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden className={`shrink-0 fill-current ${className}`}>
      <path d={mark.path} />
    </svg>
  );
}
