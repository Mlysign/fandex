import type { Metadata, Viewport } from "next";
import { DM_Serif_Display, Space_Grotesk, Space_Mono } from "next/font/google";
import "./globals.css";
import AppProviders from "@/components/ui/AppProviders";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import TelemetryBeacon from "@/components/TelemetryBeacon";
import AppNav from "@/components/AppNav";
import { BASE_URL } from "@/lib/baseUrl";

// Direction 2a "Ticket · Calm" (docs/design/fandex-handoff/01-tokens.css):
// serif for display/titles, grotesque for UI, mono for eyebrows/metadata.
// Self-hosted via next/font — no CDN — each exposes a CSS variable that
// globals.css's --font-serif/--font-sans/--font-mono tokens point at.
const dmSerif = DM_Serif_Display({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-dm-serif",
});
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
});
const spaceMono = Space_Mono({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-space-mono",
});

// The two strings a stranger is most likely to read, and for a long time the
// only two: they are the Google result. Both were rewritten on 2026-08-20 after
// the title's em-dash was called out for reading as machine-written. House rule
// (~/.claude/CLAUDE.md): no em-dashes, no three-item lists with a rhythm, no
// "not just X, it's Y". A colon does the title's job; the description says what
// the thing is and then what it does, in two sentences.
//
// Keep DESCRIPTION under ~155 characters or Google truncates it mid-sentence.
const TITLE = "Fandex: your index of every game, movie & show";
const DESCRIPTION =
  "One index for every game, movie and show. Fandex tracks your wishlist and learns your taste, so you know what's out next. Connects Trakt, Steam and TMDB.";

// P12 — SEO metadata. metadataBase makes OG/sitemap URLs absolute; the title
// template lets authed pages set just their name (e.g. "Library · Fandex").
export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: { default: TITLE, template: "%s · Fandex" },
  description: DESCRIPTION,
  applicationName: "Fandex",
  keywords: [
    "media tracker", "wishlist", "backlog", "watchlist", "release calendar",
    "game releases", "movie releases", "TV show releases", "recommendations",
    "Trakt", "Steam", "TMDB",
  ],
  openGraph: {
    type: "website",
    siteName: "Fandex",
    title: TITLE,
    description: DESCRIPTION,
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
  robots: { index: true, follow: true },
};

// P14 — theme-color for the browser/PWA chrome (Next moved this out of metadata).
// Matches --color-surface (Direction 2a's warm near-black), not a generic dark gray.
export const viewport: Viewport = {
  themeColor: "#100E0C",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${dmSerif.variable} ${spaceGrotesk.variable} ${spaceMono.variable}`}>
      {/* suppressHydrationWarning: browser extensions (e.g. Grammarly) inject
          data-* attributes on <body> before hydration, causing a benign mismatch. */}
      <body suppressHydrationWarning className="font-sans antialiased bg-surface text-text-primary min-h-screen">
        <ServiceWorkerRegister />
        {/* Self-hosted pageview counter (migration 17). Renders nothing, sets no
            cookie, sends no third-party request. */}
        <TelemetryBeacon />
        <AppProviders>
          {/* Skip-to-content link (06-accessibility.md) — visually hidden until
              focused, then anchors keyboard users past the nav to the page. */}
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[200] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-accent focus:text-text-on-accent focus:text-label"
          >
            Skip to content
          </a>
          {/* AppNav is the top bar on desktop and the fixed bottom bar on mobile;
              the content wrapper pads the bottom on mobile so the fixed bar can't
              cover the last of the page. `id="main"` is the skip-link target. */}
          <AppNav />
          {/* The bottom padding is the bar's OWN height plus the safe-area
              inset, from the same token the bar is sized against. It was a flat
              `pb-16`, which was wrong in both directions: 11px too much on a
              plain screen (dead space, and the reason a page that fit still
              scrolled a little), and too little on a notched phone, where the
              bar grows by the inset and covered the last of the content. */}
          <div
            id="main"
            tabIndex={-1}
            className="outline-none pb-[calc(var(--size-nav-bar-mobile)_+_env(safe-area-inset-bottom))] md:pb-0"
          >
            {children}
          </div>
        </AppProviders>
      </body>
    </html>
  );
}
