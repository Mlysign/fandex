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
  ],
};

export default support;
