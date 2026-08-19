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

const TITLE = "Fandex — your index of every game, movie & show";
const DESCRIPTION =
  "Fandex is your personal index of games, movies, and shows — manage wishlists, get recommendations from your own taste, and track upcoming releases on a calendar. Connects Trakt, Steam, TMDB and more.";

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
          <div id="main" tabIndex={-1} className="outline-none pb-16 md:pb-0">
            {children}
          </div>
        </AppProviders>
      </body>
    </html>
  );
}
