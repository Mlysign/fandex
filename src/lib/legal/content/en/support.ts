import type { LegalDocument } from "@/lib/legal/types";

// H4.8 — support/contact page around the already-live hello@fandex.org.
const support: LegalDocument = {
  title: "Support",
  updated: "2026-07-30",
  intro: [
    "Fandex is built and run by one person, as a hobby project alongside everything else in their life — not a company with a support team. Here's what that actually means for you.",
  ],
  sections: [
    {
      heading: "Contact",
      body: [
        "hello@fandex.org — for bug reports, account questions (including anything about your data), or general feedback.",
      ],
    },
    {
      heading: "What to expect",
      body: [
        "A genuine best effort, on the timeline of a hobby project: could be same-day, could be a couple of weeks, depending on what else is going on. There's no SLA and no guaranteed response window.",
      ],
    },
    {
      heading: "Before you write in",
      body: [
        "Two things are already self-serve and don't need an email — both live in Settings → Your data:",
        {
          list: [
            "Downloading everything Fandex holds about you, as a file you can keep.",
            "Permanently deleting your account and everything in it.",
          ],
        },
        "If your question is about either of those, you may not need to wait for a reply at all.",
      ],
    },
    {
      heading: "Bug reports",
      body: [
        "The more specific, the faster it can actually get looked at: what you were doing, what you expected, what happened instead, and — if it's about a specific title — which one.",
      ],
    },
    // H3.3, 2026-08-03. Deliberately the LAST section: the page's job is help
    // and contact, and a page that asks for money above the support address
    // reads as a pitch.
    //
    // NO CONCRETE COST FIGURE (Nils, 2026-08-03). A number would need revisiting
    // every time Railway's bill moves, and going stale on a page about money is
    // worse than being vague — "it costs money to keep running" is true
    // indefinitely and needs no maintenance.
    // Wording rules this section follows, both of which protect something real:
    //   * "no perks, no tiers" is not modesty — a donation with consideration
    //     becomes a taxable supply, and it's a much stronger "commercial use"
    //     reading against TMDB's non-commercial-only free tier.
    //   * it names running costs rather than promising features, so it can't be
    //     read as taking payment for a roadmap.
    {
      heading: "Supporting Fandex financially",
      body: [
        "Fandex is free, has no ads, and doesn't sell or share your data — none of that is planned to change. It does cost money to keep running, though: hosting, the domain, and the services it pulls data from all come out of pocket.",
        {
          rich: [
            "If you'd like to help cover that, there's a donation page at ",
            { href: "https://ko-fi.com/nilsmlynarek", label: "ko-fi.com/nilsmlynarek", external: true },
            ". It's genuinely optional.",
          ],
        },
        "What a donation does not do: there are no supporter tiers, no perks, no features behind a paywall, and no early access. Everyone gets the same Fandex. A donation covers running costs and nothing else — it buys goodwill and server bills, not a say in what gets built.",
      ],
    },
  ],
};

export default support;
