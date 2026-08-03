# Monetization go-live checklist (H3.9)

**The code is built and shipped dark.** Everything H3 v1 needs — the affiliate
layer, the disclosure UI, the donations rail — landed 2026-08-03 behind
`MONETIZATION_ENABLED`, which defaults to off. This file is the pre-flight for
turning it on. Nothing here is a code task unless it says so.

Research and legal reasoning live in [monetization-legal.md](monetization-legal.md);
this is the operational sequence. Implementation notes are in the header of
`src/lib/affiliate.ts`.

---

## The two hard gates — nothing below happens first

1. **H4.0** — legal advice on the Impressum / serviceable-address question. **Nils.**
2. **H4.2** — Impressum published with real §5 DDG content. Depends on H4.0.

The first affiliate link makes Fandex commercial under §5 DDG. `MONETIZATION_ENABLED`
exists so that gate is enforced by the code rather than by remembering it.

---

## Then, in order

3. **Sign up for the programs — in this order.** Nils, not a code task.

   **First: GOG.** It is the only affiliate-capable merchant the catalog
   *already* links to (109 of 400 sampled game links), so it's the only program
   that tags **real product pages** rather than synthesized searches — a far
   better conversion path than every other program combined. 6% of net sales,
   7-day last-click attribution, open to small sites but approval not
   guaranteed. Apply by emailing `affiliate@gog.com` with a link to the site, or
   via **Adtraction**, which handles GOG's affiliate partnerships.
   [GOG support: how to join](https://support.gog.com/hc/en-us/articles/4405004689297-How-to-join-the-GOG-Affiliate-Program),
   checked 2026-08-03.

   **Then: Humble (10%), Fanatical, GMG (~5%)** — all synthesized search links,
   all network-mediated, none with a qualifying-sales clock.

   **Last: Amazon PartnerNet — and deliberately last.** Applying starts a
   **180-day timer in which you must refer 3 qualifying sales from 3 separate
   checkouts, or Amazon closes the account** and you have to reapply.
   [Associates requirements](https://affiliate-program.amazon.com/help/node/topic/G7MJTPEP9NC3YKMG),
   checked 2026-08-03. At Fandex's traffic that clock is a real risk, and it
   starts at signup regardless of whether the site is up or the links are live.
   **Do not apply until traffic exists and `MONETIZATION_ENABLED` is on.**
   Amazon is also the only program covering movies/shows, so losing the account
   to an expired timer costs the whole non-game surface.

   **Gray-market trio (Eneba / Instant Gaming / Kinguin):** easiest approval,
   worst reputation. Decided in for v1, but nothing about them needs to be first.

4. **Per-program link mechanism** — monetization-legal.md §2 left this
   "unverified — confirm per-program before H3.4 ships". Partly closed on
   2026-08-03:
   - **Amazon: confirmed.** `?tag=` on Amazon's own domain; redirects
     disqualify commission ([Associates policies](https://affiliate-program.amazon.com/help/operating/policies),
     checked 2026-08-03). Implemented as a `param` program that structurally
     cannot be configured as a redirect.
   - **Humble: confirmed.** `?partner=` on humblebundle.com.
   - **The other five: still open, by necessity.** They run through affiliate
     networks (Partnerize, Admitad, FlexOffers, MyLead), and the template is
     only visible inside an account. This is why they're configured as a
     `{url}` template in env rather than hardcoded — **when you sign up, paste
     the network's own deep link in and no code changes.**
   - ⚠️ **The one thing to actually check at signup:** does the program require
     a **tracking script or pixel hosted on fandex.org**, as opposed to a plain
     outbound link? None of the seven appeared to, but it was not confirmed
     per-program. If any does, **stop** — see the cookie section below.

5. **Set the env vars** (see `.env.example`, or README's table). Programs
   without a credential stay inert individually, so you can go live with two
   and add the rest later.

   **Converting a network link into a template:** generate a tracking link for
   any single product page, then replace the destination portion with a
   placeholder — `{url}` if your network percent-encodes it, `{urlRaw}` if it
   appends it verbatim. Partnerize encodes; **Adtraction (GOG) does not**:

   ```
   generated:  https://track.adtraction.com/t/t?a=243&as=110183&t=2&tk=1&url=https://www.gog.com/game/some_game
   template:   https://track.adtraction.com/t/t?a=243&as=110183&t=2&tk=1&url={urlRaw}
   ```

   Picking the wrong one sends every click to a url the network can't parse, and
   it fails silently — **click one link through and confirm where you land.**

6. **Flip `MONETIZATION_ENABLED=1`.**

7. **Verify on the live site**, both auth states, on a game item page and a
   movie item page:
   - a "Where to buy" section appears, gray-market shops last and labeled
     "key reseller";
   - every commercial link carries the `Ad` marker and `rel="sponsored"`;
   - each section containing affiliate links carries the one-line notice;
   - a merchant with a real product row (GOG) appears **once**, as the product
     link, not also as a search;
   - Steam is untouched — it has no affiliate program and must not be marked.

8. **Re-run the cookie check** (monetization-legal.md §2, and
   [cookie-assessment.md](cookie-assessment.md)'s standing guard). Load an item
   page, click through one affiliate link of each type, and confirm
   `document.cookie` on **fandex.org** is unchanged — still only the three
   strictly-necessary cookies. The §25 TDDDG exemption holds because every link
   is a direct outbound `<a href>` and any redirect hop belongs to the network's
   domain, not ours. **If a cookie appears on fandex.org, the exemption is
   broken and H4.4's parked consent-banner build gets un-parked before you go
   any further** — not after.

9. **Declare the affiliate data flows** in the privacy policy (H4.3) and the
   cookie assessment (H4.5): outbound links to named third parties, what the
   click discloses (IP, user agent, referrer to the merchant), and that Fandex
   itself stores nothing about it.

10. **Confirm the disclosure wording with H4.0's lawyer** — monetization-legal.md
    §1's own open item: whether the per-link marker alone satisfies §5a UWG for
    a UI this small, or whether the page-level notice is also legally required.
    **Both are implemented**, so this can only relax the requirement, never
    block the launch.

---

## Standing guards, after go-live

- **Never add a Fandex-hosted `/out?url=…` redirect or a click-tracking pixel.**
  It would break the §25 TDDDG exemption (triggering a consent banner) *and*
  disqualify Amazon commissions. `src/lib/affiliate.ts` emits direct links only;
  keep it that way.
- **Turning it off is one env var.** `MONETIZATION_ENABLED=` and redeploy — the
  whole commercial surface disappears, tags and all. Worth remembering if a
  program's terms turn out to conflict with TMDB's or Trakt's.
- **The TMDB exposure is unchanged and deliberate** (TASKS.md H3): Fandex
  monetizes on free provider tiers. The failure mode is API-key revocation
  without notice, not a fine. **Do not contact TMDB or Trakt about commercial
  terms.**
- **Kleinunternehmer (§19 UStG):** nothing to do at "tens of €/mo". Note that
  since 2025 the €100,000 current-year ceiling ends the status *immediately*
  rather than the following year — only relevant if H3.8's Path B ever triggers.

---
_Written 2026-08-03 alongside the H3.3/H3.4 implementation. Re-verify §4's
program mechanics at signup; affiliate networks change link formats._
