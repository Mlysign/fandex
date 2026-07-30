import Link from "next/link";

// H4.1/H4.5/H4.8/H4.6/H4.7 — the ONE legal footer, at the bottom of /profile
// only (locked 2026-07-18: the BGH two-click rule needs /profile reachable
// from everywhere, which H1's nav already guarantees — a global footer is
// convention, not a legal requirement). Defaults to the "en" locale; adding
// locale detection here is explicitly out of scope for T5.
const LINKS: { href: string; label: string }[] = [
  { href: "/legal/en/privacy", label: "Privacy" },
  { href: "/legal/en/terms", label: "Terms" },
  { href: "/legal/en/support", label: "Support" },
  { href: "/legal/en/imprint", label: "Imprint" },
];

export default function LegalFooter() {
  return (
    <footer className="mt-10 pt-6 border-t border-border">
      <nav className="flex flex-wrap gap-x-4 gap-y-2 justify-center text-xs font-mono text-text-secondary" aria-label="Legal">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className="hover:text-text-primary transition-colors">
            {l.label}
          </Link>
        ))}
      </nav>
    </footer>
  );
}
