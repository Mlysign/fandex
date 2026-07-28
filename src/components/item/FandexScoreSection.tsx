"use client";
import { useEffect, useRef, useState } from "react";
import { Reason } from "@/components/discovery/types";
import { fandexScoreColor, matchStrength } from "@/components/FandexScoreBadge";
import FacetLink from "@/components/FacetLink";
import { CATEGORY_COLORS, CATEGORY_LABELS } from "@/lib/tags";
import { ROLE_COLORS, ROLE_LABELS } from "@/lib/constants";

// H5.3 — the detail-page Fandex Score panel (04-pages/item-detail.html:147/161/176,
// B6 2026-07-28): a big serif number, an accent eyebrow, and a one-line reason,
// with the scored state's reasons expandable into a breakdown overlay. Four states:
//   anon           → gated: "Sign in to see your taste-match Score." (no number)
//   coldStart      → "rate a few titles to unlock" nudge, no number (§8)
//   score == null  → "Not enough ratings yet to score this." (enough signal
//                     overall, but THIS item shares no facets with the profile —
//                     not a cold-start, just no match; mockup's sparse-item copy
//                     doubles for this case rather than adding a 5th message)
//   score present  → the number + a one-line match-strength reason + expandable
//                     reasons
//
// Q20 (2026-07-19): the breakdown is now (a) genuinely additive — `center +
// Σ contribution ≈ score`, computeFandexScore does the scaling — with an
// explicit "Baseline" row so the arithmetic is visible; (b) each reason is a
// clickable FacetLink styled like the "Tags & details" chips, not a static
// row; (c) rendered as a floating overlay that doesn't push the page layout.

function reasonColor(r: Reason): string {
  return r.kind === "tag" ? (CATEGORY_COLORS[r.category ?? "other"] ?? "#888") : (ROLE_COLORS[r.role ?? ""] ?? "#888");
}
function reasonGroupLabel(r: Reason): string {
  return r.kind === "tag" ? (CATEGORY_LABELS[r.category ?? "other"] ?? "Tag") : (ROLE_LABELS[r.role ?? ""] ?? "Person");
}

// The panel shell every state shares: 44px-ish serif number/dash on the left,
// an accent eyebrow + one-line reason filling the rest.
function ScorePanel({
  numberColor, number, eyebrow, reason, trailing, expandable, expanded, disabled, onToggle, ariaLabel, rootRef, children,
}: {
  numberColor: string; number: string; eyebrow: string; reason: React.ReactNode;
  trailing?: React.ReactNode; expandable?: boolean; expanded?: boolean; disabled?: boolean;
  onToggle?: () => void; ariaLabel?: string; rootRef?: React.RefObject<HTMLDivElement | null>;
  children?: React.ReactNode;
}) {
  const Tag = expandable ? "button" : "div";
  return (
    <div ref={rootRef} className="relative rounded-xl border border-border bg-neutral-900/40 overflow-visible">
      <Tag
        {...(expandable
          ? { onClick: onToggle, disabled, "aria-expanded": expanded, "aria-label": ariaLabel }
          : {})}
        className="w-full flex items-center gap-3.5 px-3.5 py-3 text-left disabled:cursor-default"
      >
        <span className="font-serif text-3xl leading-[0.8] shrink-0" style={{ color: numberColor }}>{number}</span>
        <span className="flex-1 min-w-0">
          <span className="block font-mono text-[9px] tracking-[.13em] uppercase text-accent">{eyebrow}</span>
          <span className="block text-xs font-medium text-text-primary mt-1">{reason}</span>
        </span>
        {trailing}
      </Tag>
      {children}
    </div>
  );
}

// One-line summary for the scored state — match strength, plus the top
// counted facet when one exists (e.g. "Strong match — you rate Thriller highly.").
function scoreReasonLine(score: number, center: number | null, top: Reason | undefined): string {
  const strength = matchStrength(score, center);
  const capped = strength.charAt(0).toUpperCase() + strength.slice(1);
  if (!top) return `${capped} for your taste.`;
  const verb = top.contribution >= 0 ? "highly" : "lower than most";
  return `${capped} — you rate ${top.label} ${verb}.`;
}

export default function FandexScoreSection({
  score, center, reasons, coldStart, anon,
}: { score: number | null; center: number | null; reasons: Reason[]; coldStart: boolean; anon?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Dismiss the overlay on any click/tap outside it (same pattern as ActionCells'
  // star picker) and on Escape.
  useEffect(() => {
    if (!expanded) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setExpanded(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setExpanded(false); };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [expanded]);

  if (anon) {
    return (
      <ScorePanel
        numberColor="var(--color-text-muted)" number="—" eyebrow="Fandex Score"
        reason={<span className="text-text-secondary font-normal">Sign in to see your taste-match Score.</span>}
      />
    );
  }
  if (coldStart) {
    return (
      <ScorePanel
        numberColor="var(--color-text-muted)" number="—" eyebrow="Fandex Score"
        reason={
          <span className="text-text-secondary font-normal">
            Rate a few titles to unlock your Fandex Score — a personalized 0-100 taste match for everything you browse.
          </span>
        }
      />
    );
  }
  if (score == null) {
    return (
      <ScorePanel
        numberColor="var(--color-text-muted)" number="—" eyebrow="Fandex Score"
        reason={<span className="text-text-secondary font-normal">Not enough ratings yet to score this.</span>}
      />
    );
  }

  const rounded = Math.round(score);
  const color = fandexScoreColor(score, center);
  // Q29: counted contributors first (by contribution, as before); capped-out
  // tags (beyond the per-category cap) sink to the bottom regardless of their
  // own dev — they're 0 either way, but grouping keeps "why isn't this
  // counted" visually separate from the real breakdown instead of interleaved.
  const sorted = [...reasons].sort((a, b) => (!!a.capped === !!b.capped ? b.contribution - a.contribution : a.capped ? 1 : -1));
  const baseline = center != null ? Math.round(center) : null;
  const topReason = sorted.find((r) => !r.capped);

  return (
    <ScorePanel
      rootRef={rootRef}
      numberColor={color}
      number={String(rounded)}
      eyebrow="Your Fandex Score"
      reason={scoreReasonLine(score, center, topReason)}
      expandable
      expanded={expanded}
      disabled={!reasons.length}
      onToggle={() => setExpanded((v) => !v)}
      ariaLabel={`Fandex Score ${rounded} out of 100${reasons.length ? " — show breakdown" : ""}`}
      trailing={reasons.length > 0 && (
        <span className="text-text-secondary text-xs shrink-0">{expanded ? "Hide why ▲" : "Why? ▼"}</span>
      )}
    >
      {/* Q20: a floating overlay (not inline layout) — positioned below the
          button, elevated above surrounding content. */}
      {expanded && (
        <div
          role="dialog"
          aria-label="Fandex Score breakdown"
          className="absolute z-30 top-full mt-1.5 left-0 right-0 sm:left-0 sm:right-auto sm:w-96 max-h-[70vh] overflow-y-auto rounded-xl border border-border-strong bg-surface-overlay shadow-2xl p-3.5 space-y-2.5"
        >
          {baseline != null && (
            <div className="flex items-center justify-between gap-3 text-xs pb-2 border-b border-border">
              <span className="text-text-secondary">Your baseline (average rating × 10)</span>
              <span className="font-semibold text-text-primary">{baseline}</span>
            </div>
          )}
          <div className="space-y-2">
            {sorted.map((r, i) => {
              const positive = r.contribution >= 0;
              const c = reasonColor(r);
              const linkable = r.kind === "tag" || r.kind === "person" || r.kind === "company";
              // Q29: the first capped row gets a divider + one-line explainer
              // above it, so "why do these look different" has an answer
              // right where the pattern starts, not repeated per row.
              const firstCapped = r.capped && sorted[i - 1]?.capped !== true;
              return (
                <div key={`${r.kind}|${r.role ?? ""}|${r.label}`}>
                  {firstCapped && (
                    <p className="text-[10px] text-text-secondary uppercase tracking-wide pt-1 pb-1.5 border-t border-border mt-1">
                      Not counted — over the per-category limit
                    </p>
                  )}
                  <div className={`flex items-start justify-between gap-3 text-xs ${r.capped ? "opacity-40" : ""}`}>
                    <span className="min-w-0 space-y-0.5">
                      <span className="flex items-center gap-1.5 flex-wrap">
                        <span className="uppercase tracking-wide text-[10px] font-bold shrink-0" style={{ color: c }}>{reasonGroupLabel(r)}</span>
                        {linkable ? (
                          <FacetLink
                            kind={r.kind as "tag" | "person" | "company"} role={r.role} label={r.label}
                            className="px-2 py-0.5 rounded-full transition-all hover:brightness-125"
                            style={{ background: `${c}22`, color: c }}
                          />
                        ) : (
                          <span className="text-text-secondary">{r.label}</span>
                        )}
                      </span>
                      {r.BA != null && r.n != null && (
                        <span className="block text-text-secondary">
                          you rate this {r.BA.toFixed(1)} avg over {r.n} title{r.n === 1 ? "" : "s"}
                        </span>
                      )}
                    </span>
                    {r.capped ? (
                      <span className="shrink-0 text-text-secondary pt-0.5">—</span>
                    ) : (
                      <span className="shrink-0 font-semibold pt-0.5" style={{ color: positive ? "var(--color-success)" : "var(--color-danger)" }}>
                        {positive ? "+" : ""}{r.contribution.toFixed(1)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {baseline != null && (
            <div className="flex items-center justify-between gap-3 text-xs pt-2 border-t border-border">
              <span className="text-text-secondary">Baseline + contributions</span>
              <span className="font-bold" style={{ color }}>{rounded}</span>
            </div>
          )}
        </div>
      )}
    </ScorePanel>
  );
}
