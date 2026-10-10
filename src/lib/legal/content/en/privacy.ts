import type { LegalDocument } from "@/lib/legal/types";

// H4.3: every factual claim here must be traceable to this repo (a table, a
// cookie, a provider, a config value).
//
// Rewritten 2026-10-10 for the move to Cloudflare (docs/app-plan.md). What each
// section was checked against:
//   what is stored        worker/migrations/0001_init.sql, the five user tables
//   no provider tokens    user_identities has no token column (docs/worker.md)
//   on your device        mobile/src/lib/storage.ts, db.ts, AuthProvider.signOut
//   one cookie            worker/src/auth/session.ts, sessionCookie()
//   no usage statistics   the counter tables exist and nothing writes them
//   last seen, daily      worker/src/auth/session.ts
//   TMDB from the device  mobile/src/lib/tmdb.ts
//   Trakt from the device mobile/src/lib/trakt.ts, traktSync.ts
//   backups               worker/src/cron.ts (nightly, to R2, EU), D1 Time Travel
//   export and deletion   the Worker has both routes; no screen calls them yet,
//                         which is why this says "write to us"
// ⚠️ The 30-day backup figure is a lifecycle rule on the R2 bucket, not code.
// If the rule is ever removed, that sentence is false.
const privacy: LegalDocument = {
  title: "Privacy Policy",
  updated: "2026-10-10",
  intro: [
    "Fandex is a one-person hobby project, not a company. This policy is written to be plain and accurate about exactly what the app stores and why, rather than assembled from a template. It is not legal advice, and it is under review pending professional legal advice (see the note on the controller's address below).",
    "It covers the website at fandex.org and the Fandex app for Android. Both are the same app and work the same way.",
  ],
  sections: [
    {
      heading: "Who controls your data",
      body: [
        "Nils Mlynarek, contactable at hello@fandex.org.",
        "The controller's full postal address is published in the Imprint, which forms part of this notice.",
      ],
    },
    {
      heading: "What Fandex stores about you",
      body: [
        "You can use Fandex without an account: the calendar, search and every title page work signed out, and nothing about you is stored. If you sign in, Fandex does not ask for your name or email address. Your account is identified only by the provider account you sign in with. Specifically, the database stores:",
        {
          list: [
            "Account: an internal account id, when the account was created, the day you were last seen, your country and display preferences if you set them (which media types and platforms you want shown), and a counter used to end your sessions when you sign out.",
            "Sign-in provider: which provider you signed in with (today that is Trakt), that provider's own account id and display name for you, and your avatar image URL if the provider supplies one. Fandex's servers do not store a password or an access token for your provider account.",
            "Your library and wishlist: which titles you've marked watched or played, which you want, your rating and any written review, the status of each, and where each entry came from (Trakt, Steam, or Fandex itself).",
            "Episodes: which episodes of a show you've marked watched.",
            "Hidden titles: the titles you asked Fandex not to suggest.",
          ],
        },
      ],
    },
    {
      heading: "What is kept on your own device",
      body: [
        "Fandex keeps a working copy on the device you use it on, so that it is fast and works without a connection. That copy holds the public catalog, your own library rows, your Fandex session and, if you signed in with Trakt, the Trakt access tokens.",
        "In a browser this lives in the browser's own storage for fandex.org. In the Android app it lives in the app's private storage, with the session and the tokens in the system keystore. The Trakt tokens are used only to talk to Trakt from your device. They are never sent to Fandex's servers, apart from the single moment of sign-in described below.",
        "Signing out removes the session, the tokens and your library rows from the device.",
      ],
    },
    {
      heading: "What Fandex does NOT store",
      body: [
        "No email address, no real name (only whatever display name your provider gives us), no payment information (Fandex has no payment feature today), no provider password or token on its servers, and no third-party analytics or advertising identifiers.",
      ],
    },
    {
      heading: "Cookies and device storage",
      body: [
        "Fandex sets one cookie: a session cookie, so that you stay signed in in a browser. It is strictly necessary and is not used for tracking or advertising. The device storage described above is likewise only what the app needs in order to work. Because all of it is strictly necessary for a service you asked for, German law (§25 TDDDG) doesn't require a consent banner for it.",
        "If Fandex ever adds analytics, advertising, or affiliate-tracking cookies, a consent banner will be added before that happens, not after.",
      ],
    },
    {
      heading: "Usage statistics",
      body: [
        "Fandex currently keeps no usage statistics of its own. There is no pageview counting, no Google Analytics, no other analytics service, no tracking script, no advertising identifier and no fingerprinting.",
        "For signed-in accounts Fandex records the day each account was last seen, at most once per day, so the operator can tell how many accounts are still in use. That date is stored on your account and is removed when you delete it.",
        "If Fandex starts counting pageviews again, it will count daily totals per kind of page with no identifier of any kind, and this section will describe it before it happens.",
      ],
    },
    {
      heading: "Providers we work with, and what is sent to them",
      body: [
        "TMDB and IGDB supply the movie, show and game information Fandex displays (titles, posters, descriptions, genres). Neither is told anything about your account.",
        {
          list: [
            "TMDB (The Movie Database): Fandex's servers ask TMDB about titles. In addition, when you search in the app, your device asks TMDB directly. TMDB then receives your search term and, like any server you contact, your IP address.",
            "IGDB (part of Twitch): game information, asked for by Fandex's servers only. IGDB never sees anything about you individually.",
            "Trakt: if you sign in with Trakt, the app on your device talks to Trakt directly. It reads your Trakt history, ratings and watchlist, and it sends your ratings, watched status and watchlist changes to your Trakt account. Fandex's servers contact Trakt once, at sign-in, to confirm which Trakt account is signing in. The token used for that one request is not kept.",
            "Images: posters and artwork are loaded by your device straight from the image servers of TMDB, IGDB and, for some games, Steam and RAWG. Each of them receives your IP address when an image loads, as any website does.",
            "Trailers: a title page with a trailer embeds YouTube's player. YouTube (Google) receives your IP address when that page loads and may set its own cookies. What YouTube does with that is governed by Google's privacy policy.",
          ],
        },
        "Most of these providers are based in the United States. What that means for your data depends on which of them we are talking about, so rather than one blanket statement, here is each case:",
        {
          list: [
            "Catalog information only: no personal data leaves Fandex's servers. A request from Fandex to TMDB or IGDB carries a title or an id and nothing about you.",
            "Requests your own device makes. Searches to TMDB, images and trailers go from your device to that provider, as they would if you visited its website. They carry your IP address and nothing from your Fandex account.",
            "The account you sign in with. If you sign in with Trakt, data goes to an account you already hold there, at your instruction, and only while you stay signed in. That transfer happens because you explicitly asked for it (Art. 49(1)(a) GDPR), and from the moment it arrives Trakt handles it under its own privacy policy, not this one.",
            "The provider that processes data on Fandex's behalf. That is Cloudflare, which delivers the website, runs the database and its backups, and routes the hello@fandex.org mailbox. The database and the backups are kept in the European Union. Cloudflare is based in the United States and its staff can reach what it hosts for us, which counts as a transfer, so Cloudflare self-certifies under the EU-US Data Privacy Framework and additionally commits to the European Commission's Standard Contractual Clauses as a fallback should that certification lapse. Checked August 2026. Certifications can be withdrawn, so this is re-checked rather than assumed.",
          ],
        },
        "Cloudflare processes this data as part of running the service, not for its own purposes. To deliver a page it necessarily sees your IP address, and it keeps short-lived technical logs of requests (the address requested, the time, and details such as the country the request came from) for a few days.",
      ],
    },
    {
      heading: "How long we keep it",
      body: [
        "Your account data is kept for as long as your account exists. When an account is deleted, every table that stores anything about you is erased in one step.",
        "The database is backed up for disaster recovery in two ways: Cloudflare can restore it to any point in the last 7 days, and a copy is written to backup storage in the European Union every night and kept for 30 days. After an account deletion, backups made before it can therefore still hold the pre-deletion state for up to 30 days, purely as a byproduct of that backup cycle rather than active retention of deleted data.",
      ],
    },
    {
      heading: "Your rights",
      body: [
        "Under the GDPR you have the right to access the data held about you, correct it if it's wrong, have it erased, restrict or object to its processing, and receive it in a portable format.",
        {
          list: [
            "Export your data: write to hello@fandex.org. You will be asked to show that the account is yours before anything is sent. You then get a JSON file of everything the app holds about you, readable on its own without any knowledge of the app's internals.",
            "Delete your account: write to hello@fandex.org, with the same check. Every table holding anything about you is erased. This is irreversible; there is no undo.",
          ],
        },
        "Both will be buttons in the app's settings again. Until they are, the email route is the way, and it is answered by a person.",
        "For anything else, such as correction, restriction or objection, contact hello@fandex.org.",
        "You also have the right to lodge a complaint with a data protection supervisory authority. Under Art. 77 GDPR you can do that with the authority in the EU or EEA country where you live, where you work, or where you believe the problem occurred. It does not have to be a German one, even though Fandex's controller is based in Germany.",
      ],
    },
    {
      heading: "Changes to this policy",
      body: [
        "This is a living document for a project that is itself still being built out, so check the \"updated\" date at the top of the page. Material changes (e.g. adding a new provider, adding analytics, or adding a payment flow) will update that date.",
      ],
    },
  ],
};

export default privacy;
