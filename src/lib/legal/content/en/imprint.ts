import type { LegalDocument } from "@/lib/legal/types";

// H4.2 — DRAFT, 2026-08-03. H4.0 is answered: the legal advice is that a
// standard imprint is sufficient, nothing special. This is that.
//
// Content complete — no placeholders left. The doc stays noindex (page.tsx) and
// excluded from sitemap.ts now that it IS filled in, precisely because it
// carries the operator's real home address; see the note in the German file.
//
// THE GERMAN VERSION IS THE LEGALLY OPERATIVE ONE. §5 DDG is German law and
// the operator is DE-based; this English rendering exists so an English-speaking
// visitor can read it, not to create a second, differently-worded obligation.
// Keep the two in lockstep — `imprint.test.ts` fails if their placeholders or
// section counts drift apart. Statute names are deliberately left in German
// with a gloss (there is no "DDG" in English, and translating a statute name
// makes it unfindable).
const imprint: LegalDocument = {
  title: "Imprint",
  updated: "2026-08-03",
  intro: [
    "Legally required operator information under German law (§ 5 DDG). The German version of this page is the operative one.",
  ],
  sections: [
    // § 5 DDG and § 18 (2) MStV both require a name and address, and it's the
    // same person at the same address — one block citing both satisfies both
    // duties without printing the address twice (2026-08-03).
    {
      heading: "Operator information (§ 5 DDG, § 18 (2) MStV)",
      body: [
        // Nils Mlynarek / Konkordiastr. 85 / 40219 Düsseldorf / Germany
        // Base64 so the address is in neither the server-rendered HTML nor the
        // JS bundle as searchable plaintext — see ProtectedText.tsx for what
        // that does and does not achieve.
        { protected: "TmlscyBNbHluYXJlawpLb25rb3JkaWFzdHIuIDg1CjQwMjE5IETDvHNzZWxkb3JmCkdlcm1hbnk=" },
      ],
    },
    {
      heading: "Contact",
      body: [
        // Email only — see the German file for the § 5 DDG / C-298/07 reasoning.
        "Email: hello@fandex.org",
      ],
    },
    // No VAT section (removed 2026-08-03, as requested). § 27a UStG only
    // requires stating a VAT identification number IF one exists — with none,
    // there is nothing to state. If one is ever issued, the section comes back.
    {
      heading: "Consumer dispute resolution",
      body: [
        "We are neither willing nor obliged to participate in dispute resolution proceedings before a consumer arbitration board.",
      ],
    },
    {
      heading: "Liability for content",
      body: [
        "As a service provider, we are responsible for our own content on these pages under general law. However, we are not obliged to monitor transmitted or stored third-party information, or to investigate circumstances that indicate unlawful activity.",
        "Obligations to remove or block the use of information under general law remain unaffected. Liability in this respect is only possible from the point at which a specific infringement becomes known. If we become aware of such infringements, we will remove the content in question immediately.",
      ],
    },
    {
      heading: "Liability for links",
      body: [
        "Our site contains links to external third-party websites over whose content we have no influence. We therefore cannot accept any responsibility for that third-party content. The respective provider or operator of the linked pages is always responsible for their content.",
        "The linked pages were checked for possible legal violations at the time of linking. Permanent monitoring of the content of linked pages is not reasonable without concrete evidence of an infringement. If we become aware of legal violations, we will remove such links immediately.",
      ],
    },
    {
      heading: "Copyright",
      body: [
        "Content and works created by the site operator on these pages are subject to German copyright law. Third-party contributions are marked as such.",
        "Metadata about films, shows and games, including titles, artwork, descriptions and ratings, comes from third-party providers and remains with the respective rights holders. Fandex is not endorsed or certified by any of them.",
      ],
    },
  ],
};

export default imprint;
