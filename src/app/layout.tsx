import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import AppProviders from "@/components/ui/AppProviders";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import { BASE_URL } from "@/lib/baseUrl";

const inter = Inter({ subsets: ["latin"] });

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
export const viewport: Viewport = {
  themeColor: "#0a0a0a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/* suppressHydrationWarning: browser extensions (e.g. Grammarly) inject
          data-* attributes on <body> before hydration, causing a benign mismatch. */}
      <body suppressHydrationWarning className={`${inter.className} bg-neutral-950 text-neutral-100 min-h-screen`}>
        <ServiceWorkerRegister />
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
