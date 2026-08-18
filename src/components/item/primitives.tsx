import { SOURCE_LABELS } from "@/lib/constants";
import BrandGlyph from "@/components/BrandGlyph";
import { fmtScore } from "./format";

// Small presentational bits shared across the item detail sections.

// A single community/critic score, formatted by its scale.
//
// 2026-08-18: the whole chip used to be tinted in the source's brand hex (fill
// at 12% alpha, text at 100%), so a row of five scores was five different
// colours, and IMDb's yellow / Metacritic's yellow were near-indistinguishable
// while meaning different scales. Now every chip is the same neutral surface and
// the SOURCE LABEL — which was always there — does the identifying. See
// components/BrandGlyph.tsx.
export function ScoreBadge({ r }: { r: { source: string; label: string; score: number; outOf: number; votes?: number | null; url?: string | null } }) {
  const text =
    r.outOf === 100 ? `${Math.round(r.score)}${r.source === "rt" || r.source === "steam" ? "%" : ""}`
    : r.outOf === 5 ? `${r.score.toFixed(1)}/5`
    : `${fmtScore(r.score)}`;
  const inner = (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm font-semibold bg-surface-elevated border border-border text-text-primary"
      title={r.votes ? `${r.label} — ${r.votes.toLocaleString()} votes` : r.label}>
      <span className="text-[10px] uppercase tracking-wide font-bold text-text-secondary">{r.label}</span>
      {text}
    </span>
  );
  return r.url
    ? <a href={r.url} target="_blank" rel="noopener noreferrer">{inner}</a>
    : inner;
}

// One fact ROW — the mockup's `.fact` (04-pages/item-detail.html:152): label left
// in secondary, value right-aligned, hairline rule above.
//
// 2026-07-30: this used to be a stacked label-over-value cell inside a
// `grid-cols-2 sm:grid-cols-3`. That grid is the main reason the page read as
// "very jagged": at mid widths the last row was ragged, the columns had nothing
// to do with the section rhythm above or below them, and a long value truncated
// with no tooltip. Rows scale to any width and give the page ONE rhythm.
//
// `align` handles the Tags row, whose value is a wrapping chip cloud rather than
// one line.
export function Fact({
  label, children, align = "center",
}: {
  label: string;
  children: React.ReactNode;
  align?: "center" | "start";
}) {
  return (
    <div className={`flex justify-between gap-4 py-2.5 border-t border-border ${align === "start" ? "items-start" : "items-center"}`}>
      <span className="text-caption text-text-secondary shrink-0">{label}</span>
      <span className="text-body-sm text-text-primary text-right min-w-0">{children}</span>
    </div>
  );
}

// One section heading. Every lower section used a hand-rolled
// `font-mono text-xs uppercase tracking-wider` <p> before 2026-07-30, so the
// eyebrows drifted from the design's `text-eyebrow` token (9px/0.13em, accent)
// used everywhere else. One component, one rhythm.
export function SectionHeading({ children }: { children: React.ReactNode }) {
  return <p className="font-mono text-eyebrow uppercase text-accent mb-3">{children}</p>;
}

// Per-platform rating chips shown under the stars.
export function RatingsBreakdown({ ratings }: { ratings: { source: string; rating: number }[] }) {
  if (!ratings || ratings.length <= 1) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
      {ratings.map((r) => (
        <span key={r.source} className="inline-flex items-center gap-1 text-xs">
          <BrandGlyph source={r.source} size={11} />
          <span className="text-text-secondary">{SOURCE_LABELS[r.source] ?? r.source}</span>
          <span className="text-text-primary font-medium">{fmtScore(r.rating)}</span>
        </span>
      ))}
    </div>
  );
}
