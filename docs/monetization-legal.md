# Monetization legal prep (H4.9)

**A document, not a page** — same convention as `cookie-assessment.md` (H4.4) and
`docs/compliance-review.md` (H4.10). This is checklist-level research to make H3.4
(affiliate implementation) decision-ready, not legal advice, and not a substitute for
H4.0's professional review. **Scoped strictly to the locked v1 model** — donations +
affiliate links only, decided 2026-07-18 (`TASKS.md`, H3) — this document does not propose
changing that model.

**Sourcing rule:** every claim below carries a source URL and the date it was checked.
Where no reliable source was found, it says "unverified — needs H4.0's lawyer" rather than
guessing.

**Researched: 2026-08-02.**

---

## 1. Affiliate-link labeling duties

**The legal basis is `§ 6 DDG` (Digitale-Dienste-Gesetz, the current successor to the old
`§ 6 TMG`) and `§ 5a UWG`** (Gesetz gegen den unlauteren Wettbewerb) — both still cited as
the operative framework as of 2026. [Germany: Advertising & Marketing – Legal 500 Country
Comparative Guides](https://www.legal500.com/guides/chapter/germany-advertising-marketing/),
accessed 2026-08-02.

**The rule:** `§ 5a Abs. 6 UWG` requires every market participant to label commercial
communications transparently enough that their commercial nature is clear to the audience —
this is the general "recognizability of advertising" duty that affiliate links fall under.
[Update on transparency requirements for influencers in Germany, the United Kingdom and the
United States – Lexology](https://www.lexology.com/library/detail.aspx?g=f744944f-072c-4c1f-a8e4-0dd7ce1cf1d6),
accessed 2026-08-02.

**Does an exemption apply?** There is a statutory carve-out where the commercial intent is
"directly apparent from context" — but German courts have not settled a consistent test for
when that carve-out actually applies. [Update on transparency requirements... –
Lexology](https://www.lexology.com/library/detail.aspx?g=f744944f-072c-4c1f-a8e4-0dd7ce1cf1d6),
accessed 2026-08-02. **This is exactly the kind of judgment call that stays with H4.0's
lawyer** — don't rely on the exemption without their sign-off; it's cheaper and safer to
just label.

**What this means for Fandex's store rows:** the case law cited above is written for
influencer posts (a single post embedded in a feed, where "is this an ad" can be genuinely
ambiguous), not a persistent UI element. A labeled "Buy" / store-link row that is
*structurally* always a commercial link (present on every item page, every time, whether or
not that specific link happens to be an affiliate one this month) is a stronger case for
"directly apparent from context" than an influencer's individual post — but this repo has no
prior compliance precedent to lean on, and it's still the kind of judgment call H4.0 should
confirm rather than this document deciding unilaterally.

**Defensible minimum, pending H4.0's confirmation:**
- **A small, persistent per-link marker** next to every affiliate store row (e.g. an
  "Affiliate" or "Werbung" tag rendered inline, not just in a tooltip or footnote) —
  matches how the existing `docs/cookie-assessment.md` and legal-doc conventions favor
  visible-by-default disclosure over buried text.
- **A one-line page-level notice** stating that some outbound store links are affiliate
  links and Fandex may earn a commission — this is the standard pattern most sites use in
  addition to per-link marking, not instead of it.
- Applies identically to the **gray-market key shops** (Eneba/Instant Gaming/Kinguin) — they
  were deliberately decided *in* (`TASKS.md`, H3.4), and nothing in `§5a UWG` distinguishes
  a "legitimate" retailer's affiliate link from a gray-market one; both are equally
  commercial communications.

**Not yet decided, needs H4.0:** whether the per-link marker alone satisfies the
recognizability duty, or whether the page-level notice is also legally required (as opposed
to just good practice) for a UI as small as a store-link row.

---

## 2. Cookie/consent interaction

**The core technical question:** does an affiliate click set a cookie on **Fandex's own
domain**, or only on the destination's? This is what decides whether H4.4's `§25 TDDDG`
strictly-necessary exemption survives H3.4 — `docs/cookie-assessment.md`'s standing guard
names this exact question.

**How standard affiliate tracking actually works:** the click carries an affiliate ID as a
URL parameter (e.g. Amazon's `?tag=...`) straight to the merchant's own domain; **the
tracking cookie is set by the merchant/network's server response on THEIR domain, not the
referring site's.** [First-Party vs Third-Party Tracking Cookies – Tune](https://www.tune.com/blog/first-party-vs-third-party-tracking-cookies-what-they-are-why-you-should-drop-them/),
accessed 2026-08-02; confirmed for the specific case of Amazon Associates: *"Amazon sets a
tracking cookie in the visitor's browser... When a user clicks on an Amazon affiliate link,
a cookie is placed on their device"* — the cookie is Amazon's, set after the browser has
already navigated to amazon.com, not before. [Understanding Amazon's Cookie Policies and
Their Impact on Affiliate Marketing – AAWP](https://getaawp.com/blog/understanding-amazons-cookie-policies/),
accessed 2026-08-02. Standard cookie window: 24 hours (90 days if an item is added to cart).
[Understanding Amazon's Cookie Policies – AAWP](https://getaawp.com/blog/understanding-amazons-cookie-policies/),
accessed 2026-08-02.

**Consequence for Fandex specifically:** if `buildStoreLink()` (the shared helper `TASKS.md`
H3.4 specifies) produces a **plain `<a href="https://partner-domain.com/...">` outbound
link** — no Fandex-hosted redirect, no click-tracking pixel embedded on fandex.org itself —
then **Fandex's own domain never sets or reads an affiliate cookie**, and the `§25 TDDDG`
exemption `cookie-assessment.md` already established is untouched. This matches that
document's own stated condition: *"if H3.4's chosen affiliate programs turn out to be
cookie-free (a straight outbound link with no tracking redirect), this assessment continues
to hold without change."*

**Amazon PartnerNet specifically:** same mechanism as the general case above — link carries
`?tag=` in the URL, cookie is Amazon's, not Fandex's. [Understanding Amazon's Cookie
Policies – AAWP](https://getaawp.com/blog/understanding-amazons-cookie-policies/), accessed
2026-08-02. Amazon also disqualifies commission on any link that routes through an
"intermediate site" redirect rather than a direct click-through — an independent reason
`buildStoreLink()` should emit direct links, not a Fandex-hosted redirect. [Amazon.com
Associates Central – Operating Agreement / Policies](https://affiliate-program.amazon.com/help/operating/policies),
accessed 2026-08-02.

**GMG / Humble / Fanatical / Eneba / Instant Gaming / Kinguin — unverified per-program, same
default expected.** All six are standard affiliate-network integrations (the same
category as Amazon Associates — a URL parameter plus a network-side cookie on the merchant's
own domain), and nothing found in this pass suggests any of them requires a
Fandex-hosted redirect or first-party tracking script. But **this document did not fetch
each program's own technical integration docs individually** — before H3.4 ships, confirm
each program's actual link format (a query-parameter link vs. a required redirect/pixel
snippet) against its own developer documentation, since a wrong assumption here is exactly
the failure mode that would silently break the `§25 TDDDG` exemption. Marked
**unverified — confirm per-program before H3.4 ships.**

**The trigger, restated:** the exemption breaks the moment `buildStoreLink()` (or any
affiliate integration) sets, reads, or requires a cookie/localStorage value on
**fandex.org itself** for attribution — e.g. a Fandex-hosted `/out?url=...` redirect that
stamps a click record before forwarding. If H3.4's implementation ever needs that pattern
(some networks require it for accurate attribution), `docs/cookie-assessment.md` must be
revisited and H4.4's parked real consent-banner build gets un-parked at that point, not
after.

---

## 3. Tax — Kleinunternehmerregelung (§19 UStG)

**Current thresholds, confirmed against a 2026 source (not just repeating `TASKS.md`'s
numbers):** since 2025-01-01, the limits are **€25,000 gross turnover in the prior calendar
year** and **€100,000 gross turnover in the current calendar year** — both conditions must
hold simultaneously. [Kleinunternehmerregelung 2026: Grenzen 25.000 € & 100.000 € (§19
UStG)](https://www.mehrwertsteuerrechner.de/kleinunternehmerregelung/), accessed 2026-08-02;
cross-confirmed by [IHK Region Stuttgart – Kleinunternehmerregelung in der
Umsatzsteuer](https://www.ihk.de/stuttgart/fuer-unternehmen/recht-und-steuern/steuerrecht/umsatzsteuer-national/kleinunternehmerregelung-in-der-umsatzsteuer-1843632),
accessed 2026-08-02. `TASKS.md`'s existing "25k€ prior year / 100k€ current year" figures are
correct and current — no change needed there.

**A change worth flagging that `TASKS.md` doesn't currently mention:** the **€100,000
current-year threshold is now a hard, immediate cutoff** — exceeding it during the year ends
Kleinunternehmer status **immediately**, not at the start of the following year as under the
pre-2025 rule. [Kleinunternehmergrenze 2026: Neue Umsatzlimits & Konsequenzen –
Taxfix](https://taxfix.de/ratgeber/selbststaendige/kleinunternehmergrenze/), accessed
2026-08-02. At Fandex's currently plausible affiliate-revenue scale ("tens of €/mo" per
`TASKS.md`'s H3 recon), this is nowhere near a live concern — but if H3.8's Path B ever
triggers meaningfully higher revenue, a mid-year VAT-registration switch on short notice is
now the actual mechanic to plan for, not a following-year one.

**Affiliate income counts toward both thresholds** — `TASKS.md`'s existing statement that
"affiliate income counts toward it" is confirmed correct; nothing found suggests any
carve-out for affiliate/commission revenue specifically.

**One new fact, unrelated to the threshold amounts but relevant if EU affiliate programs
ever get added beyond the current list:** since 2025-01-01 there is a new **EU-wide small
business exemption**, letting a German Kleinunternehmer claim the exemption in other EU
states too, not just Germany. [Kleinunternehmerregelung 2026 – Grenzen –
mehrwertsteuerrechner.de](https://www.mehrwertsteuerrechner.de/kleinunternehmerregelung/),
accessed 2026-08-02. Not currently load-bearing for Fandex's scoped v1 model — noted for
completeness only.

---

## 4. Payment-provider legal — Path B only, NOT needed for v1

**This section exists so H3.8's decision is informed if/when Path B triggers — donations and
affiliate links (the actual v1 model) involve no Fandex-run checkout at all, so nothing in
this section is a live requirement today.**

**Stripe vs. merchant-of-record (Paddle / Lemon Squeezy), current fee comparison:**

| | Base fee | Tax handling | Model |
|---|---|---|---|
| Stripe | ~2.9% + $0.30/transaction (+0.5% manual card entry, +1.5% international) | You handle VAT yourself | Direct payment processor |
| Paddle | ~5% + $0.50/transaction (+ international surcharge) | Paddle handles VAT/tax as Merchant of Record | Merchant of Record |
| Lemon Squeezy | ~5% + $0.50 base (+1.5% international) | Lemon Squeezy handles VAT/tax as Merchant of Record | Merchant of Record |

[Stripe vs Paddle vs Lemon Squeezy vs Gumroad: Fees Compared (2026) –
globalsolo.global](https://www.globalsolo.global/blog/stripe-vs-paddle-vs-lemon-squeezy-2026),
accessed 2026-08-02. **The MoR premium is roughly 1.5–2 percentage points, and what it buys
is tax filing, not lower pricing** — same source. This matches `TASKS.md`'s existing
"~5% + 50¢ + surcharges" figure for MoR options; no correction needed there.

**Practical read for Fandex, if Path B ever triggers:** at Kleinunternehmer scale (well
under the thresholds in §3), Stripe direct plus self-filed VAT is very likely still simpler
and cheaper than paying the MoR premium — the crossover toward MoR being worth it tends to
happen at a revenue scale well beyond what H3.8's own trigger threshold describes. This is a
directional read from the sources above, not a recommendation — confirm against H4.0's
advice before choosing either at implementation time.

**Consumer-law hooks already stubbed in `src/lib/legal/content/{en,de}/terms.ts` as
`TODO(H3)`:**
- **Widerrufsrecht (§356 Abs. 5 BGB) for digital content:** the normal 14-day withdrawal
  right can be extinguished early, but only if the trader (a) begins performance before the
  withdrawal period ends, (b) the consumer has **explicitly** consented to that early start,
  and (c) the consumer has **separately confirmed** they understand they lose the withdrawal
  right by consenting. [§ 356 BGB – Einzelnorm, gesetze-im-internet.de](https://www.gesetze-im-internet.de/bgb/__356.html),
  accessed 2026-08-02; consent + confirmation can be combined into one checkbox at the point
  of purchase, but the trader must additionally send a permanent-medium confirmation
  (email) that the withdrawal right has lapsed, per `§ 312f BGB`. [Vorsicht bei
  Widerrufsbelehrungen bei digitalen Inhalten und Dienstleistungen –
  Heuking](https://www.heuking.de/de/news-events/newsletter-fachbeitraege/artikel/vorsicht-bei-widerrufsbelehrungen-bei-digitalen-inhalten-und-dienstleistungen.html),
  accessed 2026-08-02. **Two concrete implementation requirements if a paid digital feature
  ever ships:** (1) a checkbox at checkout, not a pre-ticked default or a buried clause, and
  (2) a follow-up confirmation email — a UI/backend requirement, not just legal-doc text.
- **Pricing-change clause** — no specific statutory citation researched this pass; standard
  practice is advance notice (commonly 30 days) before a price change takes effect on an
  existing subscription. **Unverified — needs H4.0's lawyer** for the exact notice period
  German consumer law expects for a recurring digital subscription specifically.

---

## Before the first affiliate link goes live — checklist

Ordered, with the two hard gates first:

1. **H4.0** (legal advice on the Impressum/address question) — hard gate, done first.
2. **H4.2** (Impressum published with real content) — hard gate, depends on H4.0.
3. Confirm each affiliate program's actual link/cookie mechanism against its own developer
   docs (§2's "unverified — confirm per-program" item) — before `buildStoreLink()` ships,
   not after.
4. Build `buildStoreLink()` as a **direct outbound link**, no Fandex-hosted redirect — keeps
   §2's cookie-exemption argument intact and matches Amazon's own anti-redirect policy.
5. Ship the per-link "Affiliate"/"Werbung" marker (§1) on every store row it produces,
   applied identically to the gray-market shops.
6. Re-run `docs/cookie-assessment.md`'s check after the above — confirm no new cookie
   actually appeared on fandex.org once real affiliate links are live, not just in theory.
7. **H4.9's own open item, carried to H4.0:** confirm whether the per-link marker alone
   satisfies `§5a UWG`'s recognizability duty for Fandex's specific UI, or whether the
   page-level notice is also required (§1).
8. Sign up for the programs (GMG/Humble/Fanatical/Amazon PartnerNet + the named gray-market
   shops) — this is a Nils action, not a code task.
9. H4.9's Kleinunternehmer note (§3): no action needed at current revenue scale — just be
   aware the €100k current-year cutoff is now immediate, not a following-year grace period,
   if Path B ever changes the revenue picture.

**Not on this checklist because it's genuinely not needed for v1:** anything in §4 (payment
processor selection, Widerrufsrecht implementation, pricing-change notice) — those wait for
H3.8 to actually trigger Path B.

---
_Researched 2026-08-02, scoped to the locked v1 monetization model (donations + affiliate
only). Re-verify before H3.4 actually ships if meaningful time has passed — tax thresholds
and payment-provider fee structures both move year to year._
