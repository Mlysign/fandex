import type { LegalDocument } from "@/lib/legal/types";

// H4.5 — free-service terms, plus monetization-ready sections marked
// TODO(H3): Fandex's locked v1 monetization model is donations + affiliate
// links only (TASKS.md H3, 2026-07-18) — neither involves Fandex selling
// something directly, so the payment/Widerrufsrecht/pricing sections below
// describe a Path B (ads/one-time unlock/freemium) that hasn't been
// triggered, not something live today. Not legal advice.
const terms: LegalDocument = {
  title: "Terms of Service",
  updated: "2026-10-10",
  intro: [
    "Fandex is a free, one-person hobby project. These terms are written to be plain and honest about what that means, not a template. They are not legal advice and are under review pending professional legal advice.",
  ],
  sections: [
    {
      heading: "The service",
      body: [
        "Fandex is a free index and taste-tracking tool for movies, shows and games. There is no payment feature today, and nothing in the app currently asks you for money. Fandex is provided by Nils Mlynarek (see the Privacy Policy for contact details).",
      ],
    },
    {
      heading: "Your account",
      body: [
        "You don't create a Fandex-specific password. You sign in with a provider account (today that is Trakt), and Fandex identifies you by that connection. You're responsible for keeping your provider account secure. Fandex has no separate credential to protect on its side.",
        // 2026-10-10: the RAWG paragraph that stood here is gone with the RAWG
        // sign-in itself. Trakt's sign-in is on Trakt's own page, and the
        // Worker stores no provider token at all (docs/worker.md).
        "Your password is entered on the provider's own site and Fandex never sees it.",
      ],
    },
    {
      heading: "Acceptable use",
      body: [
        "Use Fandex for its intended purpose: tracking and discovering media. Don't attempt to circumvent rate limits, scrape the catalog at a scale that degrades the service for others, or use the connected-provider integrations for anything other than syncing your own library and ratings.",
      ],
    },
    {
      heading: "Your content",
      body: [
        "Ratings, reviews and library/wishlist entries you create in Fandex are yours. Where they're also synced to a provider you've connected (e.g. a rating pushed to your Trakt account), that copy is subject to that provider's own terms, not these ones. Fandex doesn't claim ownership of anything you write here, and doesn't share your reviews publicly on your behalf beyond what you've configured with a connected provider.",
      ],
    },
    {
      heading: "Availability",
      body: [
        "This is a hobby project run by one person, not a company with an uptime commitment. Fandex is provided \"as is\", with no guarantee of availability, and the service can be paused, changed or discontinued at any time. If it's ever shut down permanently, the data export described in the Privacy Policy is the way to take your own data with you before that happens. Asking for it while the service is still running is the right call if that's a concern.",
      ],
    },
    {
      heading: "Ending your use",
      body: [
        "You can stop using Fandex at any time by simply not using it, or by signing out, or by having your account and everything Fandex holds about you permanently deleted. Account deletion is irreversible. See the Privacy Policy for how to ask for it and exactly what gets erased.",
        "Fandex may suspend or terminate access for a violation of the acceptable-use section above.",
      ],
    },
    {
      heading: "Liability",
      body: [
        "Fandex is provided free of charge and without warranty. To the extent permitted by law, liability for damages is limited to cases of intent or gross negligence; this doesn't affect liability for injury to life, body or health, or any liability that can't be limited under German law.",
      ],
    },
    {
      heading: "Governing law",
      body: [
        "These terms are governed by the law of the Federal Republic of Germany, without prejudice to any mandatory consumer-protection provisions of your country of residence.",
      ],
    },
    {
      heading: "Future monetization (not active today)",
      body: [
        "Fandex's monetization today is donations and affiliate links only. Neither is a direct sale by Fandex to you, so neither triggers the sections below on its own. The sections that follow are placeholders for a possible later stage, such as a one-time ad-free unlock or a paid tier. No such feature exists today, and these sections are not in effect unless and until one is actually launched and announced here.",
        {
          list: [
            "Payment and subscription terms: pricing, billing cycle, and the payment processor used would be specified here once (if) a paid feature ships.",
            "Right of withdrawal (Widerrufsrecht) for digital content: under German law (§356(5) BGB), the normal 14-day withdrawal right for online purchases can end early for digital content once you've given express consent to immediate delivery and acknowledged you lose that right. If a paid digital feature ever ships, the exact consent flow and waiver mechanics would be described here, not assumed.",
            "Pricing-change clause: how far in advance you'd be notified of a price change and what happens to an existing subscription.",
          ],
        },
      ],
    },
  ],
};

export default terms;
