import Link from "next/link";
import Logo from "@/components/Logo";

// Q13 — branded 404 (was Next's default unbranded page). Server component:
// renders for unknown routes AND every notFound() call (bad item uuids,
// unknown facets), so it must not assume a session — both links are public.
export default function NotFound() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 text-center">
      <Logo size={48} className="mb-6 opacity-60" />
      <p className="text-xs font-semibold uppercase tracking-widest text-neutral-600 mb-2">404</p>
      <h1 className="text-2xl font-bold mb-2">This page doesn&apos;t exist</h1>
      <p className="text-neutral-400 text-sm max-w-sm mb-8">
        The link may be broken, or the title you&apos;re looking for isn&apos;t in the index.
      </p>
      <div className="flex items-center gap-3">
        <Link
          href="/discover"
          className="px-4 py-2 rounded-xl font-medium text-sm bg-white text-neutral-900 hover:bg-neutral-200 transition-colors"
        >
          Browse the catalog
        </Link>
        <Link
          href="/"
          className="px-4 py-2 rounded-xl font-medium text-sm border border-neutral-700 text-neutral-300 hover:text-white hover:border-neutral-500 transition-colors"
        >
          Go home
        </Link>
      </div>
    </main>
  );
}
