"use client";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import BrandGlyph from "@/components/BrandGlyph";
import FilterSection, { FilterDivider } from "./FilterSection";
import type { UiFilters, Membership } from "./types";
import { YEAR_MIN, YEAR_MAX } from "./types";
import type { PlatformOption, PlatformGroup } from "@/lib/platformKeys";
import { platformMarkName, narrowToOwned, withKnownPlatforms, groupOfKey } from "@/lib/platformKeys";
import { useKnownPlatforms } from "@/lib/useKnownPlatforms";
import { useEnabledTypes } from "@/lib/useEnabledTypes";
import { visibleTypes } from "@/lib/mediaTypes";

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
  // A 0 is SHOWN, not hidden and not disabled. It answers the question a
  // missing chip leaves hanging — "is Netflix gone, or is nothing here on
  // Netflix" — which is the whole reason the chip is rendered at all. Muted, so
  // the ones worth pressing still lead the eye.
  const empty = option.count === 0;
  return (
    <button
      onClick={onToggle}
      aria-pressed={active}
      title={empty ? `Nothing loaded here is on ${option.label}` : undefined}
      className={`inline-flex items-center gap-2 min-h-11 px-3 rounded-full border text-label transition-colors ${
        active
          ? "bg-accent-subtle border-accent text-text-primary"
          : empty
            ? "border-border text-text-muted hover:text-text-secondary"
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
   * The platforms present in the CURRENTLY LOADED set, most common first. This
   * supplies the COUNTS; the option list itself is this plus everything the
   * account is known to use, at 0 (see withKnownPlatforms).
   */
  platformOptions?: PlatformOption[];
  /** Region the streaming half was resolved for, shown so the list isn't silently wrong elsewhere. */
  platformRegion?: string | null;
  /**
   * Platform keys this account owns (Settings → Your platforms). When set, the
   * chips are narrowed to these; empty/absent means "not configured" and shows
   * everything. See narrowToOwned for why empty cannot mean "owns nothing".
   */
  ownedPlatforms?: string[] | null;
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
  label, options, selected, onToggle, emptyHint,
}: { label: string; options: PlatformOption[]; selected: string[]; onToggle: (k: string) => void; emptyHint: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  // A selected chip is always rendered, even when it falls outside the preview:
  // hiding an active filter behind "+N more" is how a list silently stops
  // matching what the controls appear to say.
  const shown = expanded
    ? options
    : options.filter((o, i) => i < PLATFORM_PREVIEW || selected.includes(o.key));
  const hidden = options.length - shown.length;

  // ⚠️ Was `return null`, and that is the defect this section is being fixed
  // for: on Discover the streaming group had no options, so the heading and the
  // whole group vanished and the sheet looked like it had lost the feature.
  // A group with nothing in it now says why.
  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-meta text-text-muted">{label}</span>
      {options.length === 0 ? (
        <p className="text-caption text-text-muted leading-relaxed">{emptyHint}</p>
      ) : (
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
      )}
    </div>
  );
}

export default function FilterPanel({ filters, onChange, platformOptions = [], platformRegion, ownedPlatforms }: FilterPanelProps) {
  const selected = filters.platforms ?? [];
  const togglePlatform = (key: string) =>
    onChange({ platforms: selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key] });

  // The account's own survey: every service and console its library touches,
  // plus what it owns and which region the streaming half was resolved for.
  // Null for anonymous visitors and until the one request lands, in which case
  // the sheet falls back to the loaded set exactly as before.
  const known = useKnownPlatforms();
  const owned = ownedPlatforms?.length ? ownedPlatforms : known?.selected ?? null;
  const region = platformRegion ?? known?.region ?? null;

  // Which groups this person is even looking at. Rendering a Games section to
  // someone who has turned Games off in Settings, or who has "Movies" pressed
  // in the chip row, is noise — the sections mirror the list, not the catalog.
  const { stored: storedTypes } = useEnabledTypes();
  const types = visibleTypes(filters.types, storedTypes);
  const showStreaming = types.includes("movie") || types.includes("show");
  const showGames = types.includes("game");

  // Loaded counts first, then everything the account knows about at 0. See
  // withKnownPlatforms: a service that disappears reads as a broken filter.
  const all = withKnownPlatforms(platformOptions, known?.options ?? []);
  const narrowed = narrowToOwned(all, owned, selected);
  const narrowing = narrowed.length < all.length;
  const streaming = narrowed.filter((o) => o.group === "streaming");
  const games = narrowed.filter((o) => o.group === "games");

  // Why a group came out empty, in its own words. Three causes with three
  // different fixes, and one message for all of them sends people to the wrong
  // one: you own nothing of that kind, we know of nothing of that kind, or
  // nothing on screen carries the data.
  const emptyHint = (group: PlatformGroup, none: string) => {
    const ownsSome = (owned ?? []).some((k) => groupOfKey(k) === group);
    if (owned?.length && !ownsSome) {
      return (
        <>
          You haven&rsquo;t picked any of these in{" "}
          <Link href="/settings" className="text-accent hover:text-accent-hover underline underline-offset-2">
            your platforms
          </Link>.
        </>
      );
    }
    return none;
  };

  return (
    <>
      <FilterDivider />

      <FilterSection label="Available on" hint={region ? `· ${region}` : undefined}>
        {!showStreaming && !showGames ? (
          <p className="text-body-sm text-text-secondary leading-relaxed">
            Nothing to filter: no media types are switched on.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {showStreaming && (
              <PlatformGroupRow
                label="Movies & shows"
                options={streaming}
                selected={selected}
                onToggle={togglePlatform}
                emptyHint={emptyHint(
                  "streaming",
                  "Nothing loaded here says where it streams. Upcoming releases usually don't yet."
                )}
              />
            )}
            {showGames && (
              <PlatformGroupRow
                label="Games"
                options={games}
                selected={selected}
                onToggle={togglePlatform}
                emptyHint={emptyHint("games", "Nothing loaded here says which platforms it runs on.")}
              />
            )}
            {narrowing && (
              // Say that the list is a subset, and say it where the subset is.
              // Without this a short list reads as "we only know about three
              // services" rather than "you told us you own three", and the
              // setting that caused it is two screens away.
              <p className="text-caption text-text-muted leading-relaxed">
                Showing the platforms you own.{" "}
                <Link href="/settings" className="text-accent hover:text-accent-hover underline underline-offset-2">
                  Edit
                </Link>
              </p>
            )}
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
