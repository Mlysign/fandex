"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import OverviewCards from "./OverviewCards";
import Histogram from "./Histogram";
import StatBar from "./StatBar";
import FacetSection from "./FacetSection";
import PosterCard, { PosterCardItem } from "@/components/PosterCard";
import { InsightsPayload, DivergenceItem, DecadeStat, FacetStat, InsightItem } from "./types";
import { buildItemHref, buildFacetHref } from "@/lib/itemUrl";
import { TYPE_COLORS, ROLE_COLORS } from "@/lib/constants";

function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-300">{children}</h2>
      {hint && <p className="text-xs text-neutral-600 mt-0.5">{hint}</p>}
    </div>
  );
}

// Round a personal rating to the histogram's ½-point bucket (1..10 axis) so a
// clicked bar matches the items that fed it.
function ratingBucket(r: number): number {
  const b = Math.min(10, Math.max(1, Math.round(r / 0.5) * 0.5));
  return Math.round(b * 10) / 10;
}
function decadeOf(date: string | null): number | null {
  if (!date) return null;
  const m = date.match(/^(\d{4})/);
  return m ? Math.floor(parseInt(m[1], 10) / 10) * 10 : null;
}

// The items behind a clicked bar / decade — a single horizontally-scrolling row
// (carousel) so a large bucket stays one row instead of a wall of cards.
function ItemCardRow({ items, label, onClose }: { items: InsightItem[]; label: string; onClose: () => void }) {
  const router = useRouter();
  return (
    <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-900/60 p-3">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-neutral-400">{label}</span>
        <button onClick={onClose} className="text-xs text-neutral-500 hover:text-white">Clear ✕</button>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2 -mb-2 snap-x">
        {items.map((it) => (
          <div key={it.id} className="w-28 sm:w-32 shrink-0 snap-start">
            <PosterCard item={it as PosterCardItem} onSelect={() => router.push(buildItemHref(it))} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── You vs the crowd ──
function DivergenceRow({ item }: { item: DivergenceItem }) {
  const router = useRouter();
  const you = item.userRating;
  const crowd = item.community / 10; // 0-100 → 0-10
  const diff = you - crowd;
  const positive = diff >= 0;
  return (
    <button
      onClick={() => router.push(buildItemHref(item))}
      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-neutral-800/60 text-left transition-colors"
    >
      <span className="flex-1 text-sm truncate text-neutral-200">{item.title}</span>
      <span className="text-xs tabular-nums text-neutral-500">you {you.toFixed(1)} · crowd {crowd.toFixed(1)}</span>
      <span className={`text-xs font-semibold tabular-nums w-12 text-right ${positive ? "text-emerald-400" : "text-rose-400"}`}>
        {positive ? "+" : ""}{diff.toFixed(1)}
      </span>
    </button>
  );
}

// ── Taste by era ──
function DecadeChart({ data, baseline, selected, onSelect }: {
  data: DecadeStat[];
  baseline: number;
  selected?: number | null;
  onSelect?: (decade: number) => void;
}) {
  if (!data.length) return <p className="text-sm text-neutral-600">Not enough dated items.</p>;
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="flex items-end gap-2 h-40">
        {data.map((d) => {
          const dimmed = selected != null && selected !== d.decade;
          return (
            <div
              key={d.decade}
              className={`flex-1 flex flex-col items-center justify-end h-full ${onSelect ? "cursor-pointer" : ""}`}
              onClick={onSelect ? () => onSelect(d.decade) : undefined}
            >
              <span className="text-[10px] leading-none text-neutral-400 tabular-nums mb-0.5">{d.avg.toFixed(1)}</span>
              <div
                className="w-full max-w-12 rounded-t transition-all"
                style={{
                  height: `${(d.avg / 10) * 100}%`,
                  background: d.avg >= baseline ? "#4ade80" : "#737373",
                  opacity: dimmed ? 0.3 : 0.85,
                  outline: selected === d.decade ? "1px solid rgba(255,255,255,0.5)" : undefined,
                  outlineOffset: 1,
                }}
                title={`${d.decade}s — avg ${d.avg.toFixed(1)} over ${d.count}`}
              />
              <span className="text-[10px] leading-none text-neutral-500 mt-1">{`${String(d.decade).slice(2)}s`}</span>
              <span className="text-[9px] leading-none text-neutral-600">×{d.count}</span>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-neutral-600 mt-2">Green = above your {baseline.toFixed(1)} average.</p>
    </div>
  );
}

// ── Most watched (a single role's facets, ranked by volume) ──
function MostWatchedColumn({ title, facets, baseline }: { title: string; facets: FacetStat[]; baseline: number }) {
  return (
    <div>
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 mb-1.5">{title}</h4>
      {facets.length === 0 ? (
        <p className="text-xs text-neutral-700 px-1 py-2">Not enough data.</p>
      ) : (
        <div className="space-y-0.5">
          {facets.map((f) => (
            <StatBar key={`${f.role ?? ""}|${f.key}`} label={f.label} value={f.avg} count={f.count}
              color={ROLE_COLORS[f.role ?? ""] ?? "#888"} baseline={baseline} href={buildFacetHref(f)} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function InsightsView({ data }: { data: InsightsPayload }) {
  const { baseline } = data;
  const [selectedBucket, setSelectedBucket] = useState<number | null>(null);
  const [selectedDecade, setSelectedDecade] = useState<number | null>(null);

  // ── Most watched: top facets per role, ranked by volume (count) ──
  const mostWatched = useMemo(() => {
    const byVolume = (kind: "person" | "company", ...roles: string[]) =>
      data.facets
        .filter((f) => f.kind === kind && roles.includes(f.role ?? ""))
        .sort((a, b) => b.count - a.count || b.avg - a.avg)
        .slice(0, 8);
    return {
      actors: byVolume("person", "cast"),
      directors: byVolume("person", "director"),
      filmStudios: byVolume("company", "studio"),
      // Game studios = both developers AND publishers (e.g. Bethesda Softworks
      // publishes Fallout but doesn't develop it) — they're distinct facet roles
      // and the section subtitle promises both.
      gameStudios: byVolume("company", "developer", "publisher"),
    };
  }, [data.facets]);

  const bucketItems = useMemo(
    () => (selectedBucket == null ? [] : data.items.filter((i) => ratingBucket(i.rating) === selectedBucket).sort((a, b) => b.rating - a.rating)),
    [selectedBucket, data.items]
  );
  const decadeItems = useMemo(
    () => (selectedDecade == null ? [] : data.items.filter((i) => decadeOf(i.releaseDate) === selectedDecade).sort((a, b) => b.rating - a.rating)),
    [selectedDecade, data.items]
  );

  const typeOrder = ["game", "movie", "show"].filter((t) => (data.byTypeHistogram[t] ?? []).some((b) => b.count > 0));

  return (
    <div className="space-y-10">
      <section>
        <SectionTitle hint={`Scored against your ${baseline.toFixed(1)}/10 average — the tick on each bar.`}>Overview</SectionTitle>
        <OverviewCards overview={data.overview} baseline={baseline} />
      </section>

      <section>
        <SectionTitle hint="How many of your ratings fall at each score (½-point buckets). Click a bar to list those items.">Rating distribution</SectionTitle>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <Histogram
            data={data.histogram} color="#a78bfa" baseline={baseline} height={160}
            selected={selectedBucket}
            onBarClick={(b) => setSelectedBucket((cur) => (cur === b ? null : b))}
          />
        </div>
        {selectedBucket != null && bucketItems.length > 0 && (
          <ItemCardRow
            items={bucketItems}
            label={`${bucketItems.length} item${bucketItems.length !== 1 ? "s" : ""} rated ${selectedBucket.toFixed(1)}`}
            onClose={() => setSelectedBucket(null)}
          />
        )}
      </section>

      {typeOrder.length > 0 && (
        <section>
          <SectionTitle hint="Your score distribution per medium — do you rate games like you rate films?">Distribution by type</SectionTitle>
          <div className="grid sm:grid-cols-3 gap-3">
            {typeOrder.map((t) => (
              <div key={t} className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2 h-2 rounded-full" style={{ background: TYPE_COLORS[t] }} />
                  <span className="text-sm font-medium text-neutral-200 capitalize">{t}s</span>
                </div>
                <Histogram data={data.byTypeHistogram[t]} color={TYPE_COLORS[t]} height={110} compact />
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionTitle hint="Average rating you gave by release decade. Click a bar to list those items.">Taste by era</SectionTitle>
        <DecadeChart
          data={data.extra.byDecade} baseline={baseline}
          selected={selectedDecade}
          onSelect={(d) => setSelectedDecade((cur) => (cur === d ? null : d))}
        />
        {selectedDecade != null && decadeItems.length > 0 && (
          <ItemCardRow
            items={decadeItems}
            label={`${decadeItems.length} item${decadeItems.length !== 1 ? "s" : ""} from the ${selectedDecade}s`}
            onClose={() => setSelectedDecade(null)}
          />
        )}
      </section>

      <section>
        <SectionTitle hint="Where your ratings most diverge from the crowd (both shown on a 0-10 scale).">You vs the crowd</SectionTitle>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-400/80 mb-2">You rate higher</h3>
            <div className="space-y-0.5">{data.extra.divergence.overRated.map((i) => <DivergenceRow key={i.id} item={i} />)}</div>
          </div>
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-rose-400/80 mb-2">You rate lower</h3>
            <div className="space-y-0.5">{data.extra.divergence.underRated.map((i) => <DivergenceRow key={i.id} item={i} />)}</div>
          </div>
        </div>
      </section>

      <FacetSection
        title="Tag ratings"
        subtitle="Average rating + count for every genre, theme and keyword in your rated library. Search any tag."
        kind="tag" facets={data.facets} baseline={baseline}
        collapsible
      />

      <FacetSection
        title="People ratings"
        subtitle="How you rate the directors, writers, creators and cast behind what you've watched. (People come from movies & shows.)"
        kind="person" facets={data.facets} baseline={baseline}
        collapsible
      />

      <FacetSection
        title="Studio ratings"
        subtitle="Developers, publishers, film studios and TV networks, ranked by how you rate their work."
        kind="company" facets={data.facets} baseline={baseline}
        collapsible
      />

      <section>
        <SectionTitle hint="Who appears most often across your rated library — actors and directors, film and game studios.">Most watched</SectionTitle>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { title: "Actors", facets: mostWatched.actors },
            { title: "Directors", facets: mostWatched.directors },
            { title: "Film studios", facets: mostWatched.filmStudios },
            { title: "Game studios", facets: mostWatched.gameStudios },
          ].map((col) => (
            <div key={col.title} className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
              <MostWatchedColumn title={col.title} facets={col.facets} baseline={baseline} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
