"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { format, parseISO } from "date-fns";
import type { MediaType } from "@/types";
import { TypeBadge } from "@/components/Badges";
import { matchStrength } from "@/components/FandexScoreBadge";
import type { Reason } from "@/components/discovery/types";

// T15 (2026-07-29) — rebuilt as a score explainer. The old version duplicated
// the card underneath it (poster, title, date, type badge, source dots) —
// this shows what the card CAN'T: the score's band, your rating/status, and
// which tags are actually driving it, with the same canonical per-tag impact
// number T10 put on the item page's own breakdown and every other tag chip.
export interface TooltipItem {
  id: string;
  title: string;
  releaseDate: string | null;
  type: string;
  rating?: number | null;
  libraryStatus?: string | null;
  fandexScore?: number | null;
  fandexCenter?: number | null;
  linkable?: boolean;
  ids?: Record<string, string | number>;
}

interface DetailResponse { fandexReasons?: Reason[] }

function ImpactChip({ r }: { r: Reason }) {
  const impact = r.impact ?? r.contribution;
  const positive = impact >= 0;
  return (
    <span className="flex items-center justify-between gap-2 text-xs">
      <span className="text-text-secondary truncate">{r.label}</span>
      <span className="shrink-0 font-semibold" style={{ color: positive ? "var(--color-success)" : "var(--color-danger)" }}>
        {positive ? "+" : ""}{impact.toFixed(1)}
      </span>
    </span>
  );
}

interface TooltipProps {
  item: TooltipItem;
  // The anchor is passed as a ref so callers don't read `.current` during their
  // own render (react-hooks/refs); we read it here in an effect, which is allowed.
  anchorRef: React.RefObject<HTMLElement | null>;
}

export default function Tooltip({ item, anchorRef }: TooltipProps) {
  // Compute position once at mount from the anchor's viewport rect.
  // Using createPortal means we render into document.body — no scroll
  // containers in the way — so plain viewport coords are correct.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const w = 260;
  // T15: content is taller than the old poster+title+date shell now that a
  // scored card also shows contributing tags — a larger vertical clamp
  // buffer than the old 240 to keep the same "never overflow the bottom
  // edge" guarantee the original positioning logic gave.
  const maxH = 340;

  const scored = item.fandexScore != null;
  const [reasons, setReasons] = useState<Reason[] | null>(null);
  const fetchedRef = useRef(false);

  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    let left = rect.right + 12;
    if (left + w > window.innerWidth) left = rect.left - w - 12;
    const top = Math.min(rect.top, window.innerHeight - maxH);
    // Position can only be known after the anchor is laid out, so this measure →
    // setState happens in an effect by necessity.
    setPos({ top, left });
  }, [anchorRef]);

  // A non-null fandexScore only ever exists for an authed, non-cold-start
  // viewer (computeFandexScore needs a real profile) — no extra session
  // probe needed before firing this. Lazy (only on actual hover-intent, this
  // component doesn't mount otherwise) and fetched at most once per hover.
  useEffect(() => {
    if (!scored || !item.id || item.linkable === false || fetchedRef.current) return;
    fetchedRef.current = true;
    const p = new URLSearchParams({ id: item.id, type: item.type });
    for (const [k, v] of Object.entries(item.ids ?? {})) {
      if (v != null) p.set(`${k}Id`, String(v));
    }
    fetch(`/api/detail?${p}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: DetailResponse | null) => { if (d?.fandexReasons) setReasons(d.fandexReasons); })
      .catch(() => {});
  }, [scored, item.id, item.type, item.ids, item.linkable]);

  if (!pos) return null;

  const rounded = scored ? Math.round(item.fandexScore!) : null;
  const band = scored ? matchStrength(item.fandexScore!, item.fandexCenter ?? null) : null;

  const tagReasons = (reasons ?? []).filter((r) => r.kind === "tag" && !r.capped);
  const positive = tagReasons.filter((r) => r.contribution >= 0).sort((a, b) => b.contribution - a.contribution).slice(0, 3);
  const negative = tagReasons.filter((r) => r.contribution < 0).sort((a, b) => a.contribution - b.contribution).slice(0, 2);
  const topReasons = [...positive, ...negative];

  const rated = typeof item.rating === "number" && item.rating > 0;

  const tooltip = (
    <div
      className="fixed z-[9999] bg-surface-overlay border border-border-strong rounded-xl shadow-2xl pointer-events-none"
      style={{ top: pos.top, left: pos.left, width: w, maxHeight: maxH, overflowY: "auto" }}
    >
      <div className="p-3 space-y-2">
        <p className="font-serif text-serif-sm text-text-primary">{item.title}</p>

        {scored ? (
          <>
            <div className="flex items-baseline gap-1.5">
              <span className="font-serif text-2xl" style={{ color: "var(--color-accent)" }}>{rounded}</span>
              <span className="text-xs text-text-secondary capitalize">{band}</span>
            </div>
            {(rated || item.libraryStatus) && (
              <p className="text-xs text-text-secondary">
                {rated && `★ ${item.rating!.toFixed(1)}/10`}
                {rated && item.libraryStatus && " · "}
                {item.libraryStatus && item.libraryStatus.charAt(0).toUpperCase() + item.libraryStatus.slice(1)}
              </p>
            )}
            {topReasons.length > 0 && (
              <div className="pt-1.5 border-t border-border space-y-1">
                {topReasons.map((r) => <ImpactChip key={`${r.kind}|${r.role ?? ""}|${r.label}`} r={r} />)}
              </div>
            )}
          </>
        ) : (
          <>
            <p className="font-mono text-meta text-text-secondary">
              {item.releaseDate ? format(parseISO(item.releaseDate), "MMM d, yyyy") : "TBA"}
            </p>
            <TypeBadge type={item.type as MediaType} />
          </>
        )}
      </div>
    </div>
  );

  return createPortal(tooltip, document.body);
}
