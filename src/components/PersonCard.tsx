import Image from "next/image";
import Link from "next/link";
import { roleLabel, type PopularPerson } from "@/lib/personRail";

// One face in Home's "Popular people" rail.
//
// ⚠️ NOT a client component, and the whole rail's value depends on that staying
// true. This card exists to put a real `<a href="/person/…">` into the FIRST
// BYTE of `/`. Home's poster rails spent months rendering nothing to a crawler
// because their data arrived through a `useEffect` fetch of a robots-disallowed
// endpoint; the fix was to hand the data down as props, and this component was
// written to that rule from the start. It has no state, no handlers and nothing
// to hydrate, so it renders once on the server and stays there.
//
// The portrait comes out of a title's stored TMDB payload. See
// lib/popularPeople.ts. No provider call, on the page every visitor loads first.
//
// ⚠️ Note where the import comes from: `lib/personRail`, the leaf with no
// imports, NOT `lib/popularPeople`, which reads the database. This component is
// rendered inside a client component, so importing the latter drags
// better-sqlite3 into the browser bundle and the homepage 500s. It did exactly
// that once, with every test green.

/** Initials for a portrait-less person: "Guillermo del Toro" → "GT". */
function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]![0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]![0] ?? "") : "";
  return (first + last).toUpperCase();
}

export default function PersonCard({ person }: { person: PopularPerson }) {
  return (
    <Link
      href={person.href}
      className="group block w-[110px] select-none"
      aria-label={`${person.name}, ${roleLabel(person.topRole)}`}
    >
      {/* A circle, not a poster box: it reads as a person at a glance and it is
          what tells this rail apart from the two poster rails above it. */}
      <div className="relative w-[110px] h-[110px] rounded-full overflow-hidden bg-surface-elevated border border-border group-hover:border-border-strong transition-colors duration-base">
        {person.portraitUrl ? (
          <Image
            src={person.portraitUrl}
            alt=""
            fill
            sizes="110px"
            className="object-cover"
          />
        ) : (
          // Never an empty circle. A portrait is missing for a real reason (the
          // person's titles carry no TMDB credits), and a blank hole reads as a
          // broken image rather than as a person we hold no photo of.
          <div className="w-full h-full flex items-center justify-center font-serif text-serif-md text-text-secondary">
            {initials(person.name)}
          </div>
        )}
      </div>

      <div className="mt-2 px-0.5">
        <div className="text-sm text-text-primary group-hover:underline underline-offset-2 line-clamp-2">
          {person.name}
        </div>
        <div className="text-label text-text-secondary mt-0.5">
          {roleLabel(person.topRole)} · {person.titleCount} titles
        </div>
      </div>
    </Link>
  );
}
