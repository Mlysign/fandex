"use client";
import { useEffect, useState } from "react";

// H4.2 — renders a `{ protected: … }` legal block: text that is kept out of the
// server-rendered HTML and assembled in the browser instead. Used for the
// operator's postal address in the Impressum.
//
// ── What this actually protects against, and what it doesn't ────────────────
//
// Be clear-eyed about this, because the technique is widely oversold:
//
//   ✅ Naive harvesters — the large majority. Anything that fetches the page
//      and regexes the HTML for an address/postcode pattern gets nothing. The
//      string is base64 in the payload, so grepping the JS chunk for
//      "Konkordiastr" also finds nothing.
//   ✅ Search indexing — but that is carried by `noindex, nofollow, noarchive,
//      nosnippet` in page.tsx plus the sitemap exclusion, NOT by this file.
//      Those directives are what Google, Bing and the well-behaved AI crawlers
//      actually honour, and they work whether or not the text is obfuscated.
//   ❌ Anything that runs a headless browser. Googlebot executes JavaScript;
//      so does any scraper built in the last decade that cares. Fifteen seconds
//      of DevTools defeats this completely.
//
// So this is a speed bump, deliberately chosen and explicitly requested
// (2026-08-03) over the two alternatives — rendering the address as an image,
// or omitting it — both of which are worse: §5 DDG requires the imprint to be
// "leicht erkennbar" and "unmittelbar erreichbar", and an address that exists
// only as a bitmap is neither accessible nor safely compliant.
//
// ── The accessibility / no-JS trade, stated plainly ─────────────────────────
//
// Once mounted, the address is REAL TEXT in the DOM — selectable, copyable, and
// read correctly by a screen reader. There is no CSS reversal, no bidi
// override, no character-splitting; those techniques break assistive tech and
// are not used here.
//
// The residual gap is a visitor with JavaScript disabled, who sees the fallback
// line instead of the address. That is the one genuine §5 DDG exposure in this
// approach, and it is why `hello@fandex.org` stays in plain text directly above
// — a contact route is always available without JavaScript. A `<noscript>`
// containing the address was considered and rejected: it would put the
// plaintext straight back into the HTML source, which is precisely what every
// naive harvester reads, making the whole thing pointless.
export default function ProtectedText({ encoded, fallback }: { encoded: string; fallback: string }) {
  const [lines, setLines] = useState<string[] | null>(null);

  useEffect(() => {
    let decoded: string[] | null = null;
    try {
      // atob yields latin1 bytes; the address contains "Düsseldorf", so it has
      // to go back through a UTF-8 decode or the umlaut renders as mojibake.
      const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
      decoded = new TextDecoder().decode(bytes).split("\n");
    } catch {
      // A malformed payload must not blank the Impressum — fall through to the
      // fallback line rather than throwing inside a legally required page.
      decoded = null;
    }
    // Deliberate: this MUST happen after hydration, never during render.
    // Decoding in render would put the address straight into the
    // server-rendered HTML, which is the entire thing this component exists to
    // prevent. Decoding is done first and committed once, so it's a single
    // state write rather than one per branch.
    //
    // NB: the directive has to be the LAST comment line before the call — a
    // justification written after it on further `//` lines makes
    // `disable-next-line` target the comment instead, and it silently stops
    // suppressing anything (the rule is an ERROR in this repo, so lint caught it).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLines(decoded);
  }, [encoded]);

  if (lines === null) {
    return <p className="text-sm text-text-secondary leading-relaxed italic">{fallback}</p>;
  }

  return (
    <address className="text-sm text-text-secondary leading-relaxed not-italic">
      {lines.map((line, i) => (
        <span key={i} className="block">
          {line}
        </span>
      ))}
    </address>
  );
}
