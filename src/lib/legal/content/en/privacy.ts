import type { LegalDocument } from "@/lib/legal/types";

// H4.3 — every factual claim here must be traceable to this repo (a table, a
// cookie, a provider in the registry, a config value). Where a fact isn't
// verifiable from the code, it's marked TODO(H4.3) rather than guessed.
const privacy: LegalDocument = {
  title: "Privacy Policy",
  updated: "2026-07-30",
  intro: [
    "Fandex is a one-person hobby project, not a company. This policy is written to be plain and accurate about exactly what the app stores and why — not a template. It is not legal advice, and it is under review pending professional legal advice (see the note on the controller's address below).",
  ],
  sections: [
    {
      heading: "Who controls your data",
      body: [
        "Nils Mlynarek, contactable at hello@fandex.org.",
        "TODO(H4.0/H4.2): a postal address is normally expected here for a German data controller. Fandex does not publish one yet — this is intentionally pending professional legal advice on how to satisfy that requirement without publishing a home address (see the Imprint page).",
      ],
    },
    {
      heading: "What Fandex stores about you",
      body: [
        "Fandex does not ask for your name or email address. Your account is identified only by the provider account(s) you connect. Specifically, the app's database stores:",
        {
          list: [
            "Account: an internal account id, when the account was created, when you were last seen, your country setting (used to localize release dates and streaming availability), and a session-invalidation counter used when you sign out or disconnect a provider.",
            "Connected providers: which provider (Trakt, Steam, TMDB, RAWG — see \"Providers we work with\" below) you connected, that provider's own account id and display name for you, your avatar image URL if the provider supplies one, and an access token (and refresh token, where the provider issues one) so the app can act on your behalf. Tokens are encrypted at rest before they are stored — the database never holds them in plain text.",
            "Your library: which titles you've marked watched/played, your rating and any written review, and which of your connected providers each entry came from.",
            "Your wishlist: which titles you want, and which providers each came from.",
            "Per-provider item state: for items with more nuanced state across providers (e.g. \"in progress\" on one service), a record per provider of that title's status, rating and review.",
            "Sync history: a log of each sync run per provider — when it ran, how many items it touched, and whether it succeeded — used only for diagnosing sync problems.",
          ],
        },
      ],
    },
    {
      heading: "What Fandex does NOT store",
      body: [
        "No email address, no real name (only whatever display name your connected provider gives us), no payment information (Fandex has no payment feature today), and no third-party analytics or advertising identifiers — there are none in the app.",
      ],
    },
    {
      heading: "Cookies",
      body: [
        "Fandex sets three cookies, all strictly necessary for the app to function and none used for tracking or advertising: a session cookie so you stay signed in, and two short-lived (10-minute) security cookies used only during the moment you connect a provider account, to prevent a cross-site forgery of that connection. Because every cookie is strictly necessary, German law (§25 TDDDG) doesn't require a consent banner for them — this conclusion, and the full list with exact names and lifetimes, is recorded separately for anyone who wants the detail.",
        "If Fandex ever adds analytics, advertising, or affiliate-tracking cookies, a consent banner will be added before that happens — not after.",
      ],
    },
    {
      heading: "Providers we work with, and what we send them",
      body: [
        "TMDB, RAWG and IGDB supply the movie/show/game metadata (titles, posters, descriptions, genres) Fandex displays — the app queries them with a title or id, and doesn't send them anything about you unless you connect your own account with that provider.",
        {
          list: [
            "TMDB (The Movie Database) — metadata always; if you connect your TMDB account, the app also sends your own ratings and watchlist actions to your TMDB account, and reads them back.",
            "Trakt — if you connect your Trakt account, the app sends your ratings, watched status and watchlist actions to your Trakt account, and reads your existing Trakt library back.",
            "RAWG — game metadata always; if you connect your RAWG account, the app also sends your ratings and wishlist actions to it, and reads them back.",
            "Steam — if you connect your Steam account, the app reads your owned games and playtime. Steam's API does not support writing ratings or watchlist changes back, so nothing is sent to Steam beyond the read request itself.",
            "IGDB — game metadata only, via an app-level API key. It never sees anything about you individually.",
          ],
        },
        "TODO(H4.3): the exact legal transfer basis for each of these US-based providers (standard contractual clauses, an adequacy decision, or another basis) has not been individually confirmed against each provider's current terms and should be verified and named here before this policy is treated as final.",
        "Fandex is hosted on Railway, with DNS and the hello@fandex.org contact mailbox routed through Cloudflare. Both providers process data as part of running the service (hosting the database, delivering the app, and routing the one contact address) rather than receiving it for their own purposes.",
      ],
    },
    {
      heading: "How long we keep it",
      body: [
        "Your account data is kept for as long as your account exists. If you delete your account (Settings → Your data), every table that stores anything about you is erased in one transaction — see \"Deleting your account\" below for how that's actually implemented, not just promised.",
        "The database is continuously backed up for disaster recovery. Backup snapshots are retained for 24 hours before being replaced by a fresh one, so after an account deletion, a small window (up to 24 hours) can exist where a backup snapshot still reflects the pre-deletion state, purely as a byproduct of that backup cycle rather than active retention of deleted data.",
        "CSP violation reports (a security mechanism that logs when the browser blocks a resource the app didn't intend to load) are written to Railway's server logs, which are operational logs rather than a database table with its own separate retention setting.",
      ],
    },
    {
      heading: "Your rights",
      body: [
        "Under the GDPR you have the right to access the data held about you, correct it if it's wrong, have it erased, restrict or object to its processing, and receive it in a portable format. Two of these are already self-serve, not just promised on paper:",
        {
          list: [
            "Export your data — Settings → Your data → download a JSON file of everything the app holds about you, readable on its own without any knowledge of the app's internals.",
            "Delete your account — Settings → Your data → a type-to-confirm dialog that erases every table holding anything about you. This is irreversible; there is no undo.",
          ],
        },
        "For anything else — correction, restriction, objection — contact hello@fandex.org.",
        "You also have the right to lodge a complaint with a data protection supervisory authority. TODO(H4.3): the specific competent authority (tied to the controller's actual registered location once H4.0 resolves) has not been named yet.",
      ],
    },
    {
      heading: "Changes to this policy",
      body: [
        "This is a living document for a project that is itself still being built out — see the \"updated\" date at the top of the page. Material changes (e.g. adding a new provider, adding analytics, or adding a payment flow) will update that date.",
      ],
    },
  ],
};

export default privacy;
