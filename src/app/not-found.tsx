import Link from "next/link";
import Logo from "@/components/Logo";

// Q13 — branded 404 (was Next's default unbranded page). Server component:
// renders for unknown routes AND every notFound() call (bad item uuids,
// unknown facets), so it must not assume a session — both links are public.
export default function NotFound() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 text-center">
      {/* H1.6f: this page sits outside the IA route list, so H1.6e's
          page-by-page token sweep never reached it — it was still entirely on
          pre-H1.6 styling (raw white button, neutral-600 eyebrow at 1.57:1).
          Classes only; no dependency on the "use client" Button/Eyebrow
          primitives, since this is a server component. */}
      <Logo size={48} className="mb-6 opacity-60" />
      <p className="font-mono text-eyebrow uppercase text-accent mb-2">404</p>
      <h1 className="font-serif text-serif-xl text-text-primary mb-2">This page doesn&apos;t exist</h1>
      <p className="text-text-secondary text-sm max-w-sm mb-8">
        The link may be broken, or the title you&apos;re looking for isn&apos;t in the index.
      </p>
      <div className="flex items-center gap-3">
        <Link
          href="/discover"
          className="px-4 py-2 rounded-lg font-semibold text-label bg-accent text-text-on-accent hover:bg-accent-hover transition-colors"
        >
          Browse the catalog
        </Link>
        <Link
          href="/"
          className="px-4 py-2 rounded-lg font-semibold text-label border border-border-strong text-text-secondary hover:text-text-primary hover:border-neutral-400 transition-colors"
        >
          Go home
        </Link>
      </div>
    </main>
  );
}
