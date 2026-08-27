"use client";
import { useEffect, useState } from "react";
import BrandGlyph from "@/components/BrandGlyph";
import FilterSection, { FilterDivider } from "./FilterSection";
import type { UiFilters, Membership } from "./types";
import { YEAR_MIN, YEAR_MAX } from "./types";
import type { PlatformOption } from "@/lib/platformKeys";
import { platformMarkName } from "@/lib/platformKeys";

// The Filters sheet's own controls: Available on, Your lists, Release year.
// Must-include / must-exclude live in SubBar, which owns the facet props — the
// sheet renders both in one sectioned column.
//
// Rebuilt 2026-08-27 to Option A of the mockups Nils picked. What changed and
// why, since each was a reported defect:
//  · Sections instead of one wrapping flex row (the old layout wrapped ugly).
//  · The year is TWO fields, not a dual slider — two thumbs 4px apart at the
//    extremes of a 160px track is not a touch control.
//  · Every segment and chip is a real 44px target. The old Any/Only/Hide
//    segments were 31px, inside a 44px row, so the row looked compliant and the
//    thing you actually tap was not.
//  · "Available on" is new (PL: platform filter).
// Source / Community / Runtime were removed by T24 and stay removed.

// 3-explicit-button Any/Only/Hide — kept distinct from ui/TriToggle (which
// models Include/Exclude with an IMPLICIT "neither" state per
// 03-components.md §6c): this control shows "Any" as its own clickable segment
// rather than "nothing pressed", which is the established behaviour here.
function Tri({ label, value, onChange }: { label: string; value: Membership | undefined; onChange: (v: Membership | undefined) => void }) {
  const opts: [string, Membership | undefined][] = [["Any", undefined], ["Only", "only"], ["Hide", "exclude"]];
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-body-sm text-text-primary">{label}</span>
      <div role="group" aria-label={label} className="flex rounded-lg border border-border-strong overflow-hidden">
        {opts.map(([optLabel, v]) => {
          const active = value === v;
          return (
            <button
              key={optLabel}
              onClick={() => onChange(v)}
              aria-pressed={active}
              // min-h-11 = 44px. The row around it was already 44; the SEGMENT
              // was 31, which is the part a thumb has to hit.
              className={`min-h-11 px-4 text-label transition-colors ${active ? "bg-accent-subtle text-accent" : "text-text-secondary hover:text-text-primary"}`}
            >
              {optLabel}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// A year field. Commits on blur and on Enter, not per keystroke: typing "19" on
// the way to "1995" would otherwise clamp to YEAR_MIN and fight the caret.
function YearField({
  label, value, min, max, onCommit,
}: { label: string; value: number; min: number; max: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  // Prop→state sync: Reset all and the other field's clamping both change
  // `value` from outside, and the draft has to follow or the box shows a stale
  // number. Same justified disable the repo's other prop-mirroring inputs use.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setDraft(String(value)); }, [value]);

  const commit = () => {
    const n = parseInt(draft, 10);
    if (Number.isNaN(n)) { setDraft(String(value)); return; }
    onCommit(Math.min(max, Math.max(min, n)));
  };

  return (
    <label className="flex-1 min-w-0 flex flex-col justify-center gap-0.5 min-h-11 px-3 rounded-lg border border-border-strong bg-surface-elevated focus-within:border-accent transition-colors">
      <span className="font-mono text-eyebrow uppercase text-text-muted">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        value={draft}
        min={min}
        max={max}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }}
        // appearance-none kills the spinner arrows, which are unusable at this
        // size and steal the tap target's right edge on mobile Safari.
        className="w-full bg-transparent border-0 outline-none p-0 font-mono text-body tabular-nums text-text-primary appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
    </label>
  );
}

function PlatformChip({ option, active, onToggle }: { option: PlatformOption; active: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      aria-pressed={active}
      className={`inline-flex items-center gap-2 min-h-11 px-3 rounded-full border text-label transition-colors ${
        active
          ? "bg-accent-subtle border-accent text-text-primary"
          : "border-border-strong text-text-secondary hover:text-text-primary"
      }`}
    >
      {/* A LOGO, never a brand hue — platform colour-coding is removed
          site-wide and BrandGlyph is the one way to identify a provider.
          It renders nothing for a name it doesn't know, which is why the
          label carries the meaning on its own. */}
      <BrandGlyph source={platformMarkName(option.label)} size={16} />
      <span className="whitespace-nowrap">{option.label}</span>
      <span className="font-mono text-meta text-text-muted tabular-nums">{option.count}</span>
    </button>
  );
}

export interface FilterPanelProps {
  filters: UiFilters;
  onChange: (patch: Partial<UiFilters>) => void;
  /**
   * The platforms present in the CURRENTLY LOADED set, most common first.
   * Omit (or pass an empty list) on a surface that holds no availability data —
   * the section then says so instead of rendering an empty row.
   */
  platformOptions?: PlatformOption[];
  /** Region the streaming half was resolved for, shown so the list isn't silently wrong elsewhere. */
  platformRegion?: string | null;
}

// How many chips a group shows before "+N more".
//
// ⚠️ Measured, not guessed: a real German library offers **57** streaming
// providers, most of them a long tail of regional channels with single-digit
// counts (Filmlegenden 15, BATTLEZONE 8, Home of Horror 8…). Rendering all of
// them turns the section into a wall you have to scroll past to reach Your
// lists, which is the wrapping complaint in a new costume. Eight covers every
// service with a meaningful share and keeps the rest one tap away.
const PLATFORM_PREVIEW = 8;

function PlatformGroupRow({
  label, options, selected, onToggle,
}: { label: string; options: PlatformOption[]; selected: string[]; onToggle: (k: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  // A selected chip is always rendered, even when it falls outside the preview:
  // hiding an active filter behind "+N more" is how a list silently stops
  // matching what the controls appear to say.
  const shown = expanded
    ? options
    : options.filter((o, i) => i < PLATFORM_PREVIEW || selected.includes(o.key));
  const hidden = options.length - shown.length;

  if (options.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-meta text-text-muted">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((o) => (
          <PlatformChip key={o.key} option={o} active={selected.includes(o.key)} onToggle={() => onToggle(o.key)} />
        ))}
        {hidden > 0 && (
          <button
            onClick={() => setExpanded(true)}
            className="inline-flex items-center min-h-11 px-3 rounded-full border border-dashed border-border-strong text-label text-accent hover:text-accent-hover transition-colors"
          >
            +{hidden} more
          </button>
        )}
        {expanded && options.length > PLATFORM_PREVIEW && (
          <button
            onClick={() => setExpanded(false)}
            className="inline-flex items-center min-h-11 px-3 rounded-full border border-dashed border-border-strong text-label text-text-secondary hover:text-text-primary transition-colors"
          >
            Show less
          </button>
        )}
      </div>
    </div>
  );
}

export default function FilterPanel({ filters, onChange, platformOptions = [], platformRegion }: FilterPanelProps) {
  const selected = filters.platforms ?? [];
  const togglePlatform = (key: string) =>
    onChange({ platforms: selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key] });

  const streaming = platformOptions.filter((o) => o.group === "streaming");
  const games = platformOptions.filter((o) => o.group === "games");

  return (
    <>
      <FilterDivider />

      <FilterSection label="Available on" hint={platformRegion ? `· ${platformRegion}` : undefined}>
        {platformOptions.length === 0 ? (
          // Never an empty section. "Nothing loaded yet" and "this surface holds
          // no availability data" both read as a broken filter otherwise.
          <p className="text-body-sm text-text-secondary leading-relaxed">
            Nothing loaded so far says where it can be watched or played. Scroll further, or open a title to fill this in.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <PlatformGroupRow label="Movies & shows" options={streaming} selected={selected} onToggle={togglePlatform} />
            <PlatformGroupRow label="Games" options={games} selected={selected} onToggle={togglePlatform} />
            {selected.length > 0 && (
              // Stated up front, because it changes what the filter returns:
              // matchesPlatforms DROPS an item we hold no availability for.
              <p className="text-caption text-text-muted leading-relaxed">
                Titles we hold no availability for are hidden while this is on.
              </p>
            )}
          </div>
        )}
      </FilterSection>

      <FilterDivider />

      <FilterSection label="Your lists">
        <div className="flex flex-col gap-1">
          <Tri label="In library" value={filters.membership.library} onChange={(v) => onChange({ membership: { ...filters.membership, library: v } })} />
          <Tri label="On wishlist" value={filters.membership.wishlist} onChange={(v) => onChange({ membership: { ...filters.membership, wishlist: v } })} />
          {/* A2 (H1.6c): the already-rated dimension, same control. */}
          <Tri label="Rated" value={filters.membership.rated} onChange={(v) => onChange({ membership: { ...filters.membership, rated: v } })} />
        </div>
      </FilterSection>

      <FilterDivider />

      <FilterSection label="Release year">
        <div className="flex items-center gap-2.5">
          <YearField
            label="From"
            value={filters.yearRange[0]}
            min={YEAR_MIN}
            max={filters.yearRange[1]}
            onCommit={(v) => onChange({ yearRange: [v, Math.max(v, filters.yearRange[1])] })}
          />
          <span className="text-text-muted" aria-hidden>–</span>
          <YearField
            label="To"
            value={filters.yearRange[1]}
            min={filters.yearRange[0]}
            max={YEAR_MAX}
            onCommit={(v) => onChange({ yearRange: [Math.min(filters.yearRange[0], v), v] })}
          />
        </div>
      </FilterSection>
    </>
  );
}
