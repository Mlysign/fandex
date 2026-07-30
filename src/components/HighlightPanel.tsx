"use client";
import Link from "next/link";
import Image from "next/image";
import Panel from "@/components/ui/Panel";
import Eyebrow from "@/components/ui/Eyebrow";
import type { Highlight } from "@/lib/homeHighlights";

// One rotating highlight (2026-07-30). Anatomy is the mockup's best-genre panel
// verbatim (04-pages/home.html): accent eyebrow → serif headline → mono detail
// line. The old Home had exactly one of these, hard-wired to "Your top genre";
// there are now seven generators and two are drawn per day.
//
// A recommendation highlight carries a poster, so it gets a small thumb — that's
// what distinguishes "here's a stat about you" from "here's something to watch"
// at a glance, without a second panel style.
export default function HighlightPanel({ highlight }: { highlight: Highlight }) {
  const body = (
    <>
      {highlight.posterUrl && (
        <div className="relative w-11 h-16 shrink-0 rounded-md overflow-hidden bg-surface-inset">
          <Image src={highlight.posterUrl} alt="" fill sizes="44px" className="object-cover" />
        </div>
      )}
      <div className="min-w-0">
        <Eyebrow>{highlight.eyebrow}</Eyebrow>
        <div className="font-serif text-serif-md text-text-primary mt-1.5 line-clamp-2">{highlight.value}</div>
        <div className="font-mono text-meta text-text-secondary mt-1.5">{highlight.detail}</div>
      </div>
    </>
  );

  const inner = <div className="flex items-start gap-3">{body}</div>;

  // Every highlight links somewhere real (a facet page or an item), so the whole
  // panel is the target rather than a separate "see more" affordance.
  return (
    <Panel className="flex-1 min-w-[13rem] px-4 py-3.5">
      {highlight.href ? (
        <Link href={highlight.href} className="block group">
          <div className="flex items-start gap-3 transition-opacity group-hover:opacity-80">{body}</div>
        </Link>
      ) : (
        inner
      )}
    </Panel>
  );
}
