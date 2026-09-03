"use client";
import { useCallback, useEffect, useState } from "react";
import type { TagCategoryConfig } from "./types";
import { tagCategoryHex } from "@/lib/facetPalette";

// Taxonomy → Review (2026-09-03).
//
// Nils: "can you do a sweep of all tags and franchises? ... build me an easy way
// to review those suggestions and either accept, deny or correct them right
// away."
//
// Three verbs on every card, because that was the ask and because two of them
// are not enough. Accept and Deny alone force a wrong-but-close suggestion to be
// thrown away and redone by hand somewhere else, which is how a review queue
// stops getting used. So every card also carries the correction that its own
// shape needs: a different category for a tag batch, the other direction for a
// merge, a different franchise for a membership.
//
// ⚠️ There is no "apply" endpoint. Accepting posts to the SAME routes the manual
// panels post to (/overrides, /franchises, /categories), so nothing here can
// reach a write path that manual review does not already exercise, and every
// invariant those routes carry keeps holding without being restated. The only
// endpoint this screen owns is the one that remembers a NO.

interface SuggestedTag { key: string; label: string; count: number }

interface TagCard {
  kind: "tag-category";
  ref: string; title: string; why: string;
  categoryId: string; categoryLabel: string;
  createsCategory: { id: string; label: string } | null;
  tags: SuggestedTag[];
  itemsAffected: number;
}
interface MergeCard {
  kind: "franchise-merge";
  ref: string; title: string; why: string;
  aliasKey: string; aliasLabel: string; aliasSize: number; aliasSample: string[];
  canonicalKey: string; canonicalLabel: string; canonicalSize: number; canonicalSample: string[];
}
interface MemberCard {
  kind: "franchise-member";
  ref: string; title: string; why: string;
  mediaItemId: string; itemTitle: string; itemType: string;
  ipKey: string; ipLabel: string; franchiseSize: number;
}
type Card = TagCard | MergeCard | MemberCard;

interface Report {
  suggestions: Card[];
  stats: {
    totalTags: number; otherTags: number; otherAfterAccepting: number;
    tagsCovered: number; itemsAffected: number;
    franchises: number; singletonFranchises: number; dismissed: number;
  };
}

const inputCls = "bg-neutral-950 border border-neutral-700 rounded-md px-2 py-1 text-sm text-neutral-100";
const primaryBtn = "px-3 py-1 rounded-md bg-neutral-700 hover:bg-neutral-600 text-sm text-neutral-100 transition-colors disabled:opacity-40";
const ghostBtn = "px-2 py-1 rounded-md text-xs text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 transition-colors disabled:opacity-40";
const MEMBER_PAGE = 40;

type Lens = "all" | "tag-category" | "franchise-merge" | "franchise-member";
const LENSES: { id: Lens; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "tag-category", label: "Tag categories" },
  { id: "franchise-merge", label: "Franchise merges" },
  { id: "franchise-member", label: "Missing members" },
];

export default function ReviewPanel({
  categories, onChanged,
}: {
  categories: TagCategoryConfig[];
  onChanged: () => void;
}) {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [lens, setLens] = useState<Lens>("all");
  const [memberLimit, setMemberLimit] = useState(MEMBER_PAGE);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    setError(null);
    try {
      const res = await fetch(`/api/dev/scoring/suggestions${refresh ? "?refresh=1" : ""}`);
      if (!res.ok) throw new Error(`Sweep failed (${res.status})`);
      setReport(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sweep failed");
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  // Drop the card immediately, then re-sweep in the background. The sweep is two
  // whole-catalog scans, so waiting for it before the card disappears would put
  // a second of dead air after every single click.
  function settle(ref: string) {
    setReport((r) => (r ? { ...r, suggestions: r.suggestions.filter((s) => s.ref !== ref) } : r));
    void load(true);
  }

  async function post(url: string, body: unknown): Promise<boolean> {
    const res = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? `Request failed (${res.status})`);
    }
    return res.ok;
  }

  async function acceptTags(card: TagCard, tagKeys: string[], categoryId: string) {
    if (!tagKeys.length) return;
    setBusy(card.ref);
    setError(null);
    try {
      // A rule may target a category that does not exist yet. Create it FIRST
      // and bail if that fails: writing overrides pointing at a missing id would
      // leave every one of those tags rendering under "Other" anyway (see
      // groupTagsByCategory's unresolvable-id fallback), which looks exactly
      // like the accept having done nothing.
      if (card.createsCategory && !categories.some((c) => c.id === categoryId)) {
        const made = await post("/api/dev/scoring/categories", {
          id: card.createsCategory.id,
          label: card.createsCategory.label,
          color: tagCategoryHex(card.createsCategory.id),
          weight: 1,
          ignored: false,
        });
        if (!made) return;
      }
      if (!(await post("/api/dev/scoring/overrides", { tagKeys, categoryId }))) return;
      onChanged();
      settle(card.ref);
    } finally {
      setBusy(null);
    }
  }

  async function bundle(ref: string, aliasKey: string, canonicalKey: string) {
    setBusy(ref);
    setError(null);
    try {
      if (!(await post("/api/dev/scoring/franchises", { action: "bundle", alias: aliasKey, canonical: canonicalKey }))) return;
      onChanged();
      settle(ref);
    } finally {
      setBusy(null);
    }
  }

  async function attach(ref: string, mediaItemId: string, label: string) {
    setBusy(ref);
    setError(null);
    try {
      if (!(await post("/api/dev/scoring/franchises", { action: "attach", mediaItemId, label }))) return;
      onChanged();
      settle(ref);
    } finally {
      setBusy(null);
    }
  }

  async function deny(kind: string, ref: string) {
    setBusy(ref);
    try {
      if (!(await post("/api/dev/scoring/suggestions", { kind, ref }))) return;
      settle(ref);
    } finally {
      setBusy(null);
    }
  }

  const all = report?.suggestions ?? [];
  const shown = lens === "all" ? all : all.filter((s) => s.kind === lens);
  const members = shown.filter((s): s is MemberCard => s.kind === "franchise-member");
  const nonMembers = shown.filter((s) => s.kind !== "franchise-member");
  const franchiseLabels = [...new Set(all.flatMap((s) =>
    s.kind === "franchise-merge" ? [s.canonicalLabel, s.aliasLabel] : s.kind === "franchise-member" ? [s.ipLabel] : []
  ))].sort();

  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-neutral-200">Review</h2>
          <p className="text-xs text-neutral-500 mt-0.5 max-w-xl">
            What the catalog says is wrong with its own vocabulary. Nothing here is applied until you say so, and a
            denial is remembered, so the same card never comes back.
          </p>
        </div>
        <button onClick={() => { setLoading(true); void load(true); }} disabled={loading} className={ghostBtn}>
          {loading ? "Sweeping…" : "Re-run sweep"}
        </button>
      </div>

      {report && <Stats stats={report.stats} />}

      <div className="flex flex-wrap items-center gap-1.5">
        {LENSES.map((l) => {
          const n = l.id === "all" ? all.length : all.filter((s) => s.kind === l.id).length;
          return (
            <button
              key={l.id}
              onClick={() => { setLens(l.id); setMemberLimit(MEMBER_PAGE); }}
              aria-pressed={lens === l.id}
              className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                lens === l.id ? "bg-neutral-800 text-neutral-100" : "text-neutral-500 hover:text-neutral-300 hover:bg-neutral-900"
              }`}
            >
              {l.label} <span className="text-neutral-600">{n}</span>
            </button>
          );
        })}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
      {loading && !report && <p className="text-sm text-neutral-600">Running the sweep…</p>}
      {report && shown.length === 0 && (
        <p className="text-sm text-neutral-600 py-4">Nothing left to review here.</p>
      )}

      <div className="space-y-2.5">
        {nonMembers.map((s) =>
          s.kind === "tag-category" ? (
            <TagCardView key={s.ref} card={s} categories={categories} busy={busy === s.ref}
              onAccept={acceptTags} onDeny={() => deny(s.kind, s.ref)} />
          ) : (
            <MergeCardView key={s.ref} card={s} busy={busy === s.ref}
              onBundle={bundle} onDeny={() => deny(s.kind, s.ref)} />
          )
        )}

        {members.length > 0 && (
          <>
            {members.slice(0, memberLimit).map((s) => (
              <MemberCardView key={s.ref} card={s} busy={busy === s.ref} franchiseLabels={franchiseLabels}
                onAttach={attach} onDeny={() => deny(s.kind, s.ref)} />
            ))}
            {members.length > memberLimit && (
              <button onClick={() => setMemberLimit((n) => n + MEMBER_PAGE)} className={ghostBtn}>
                Show {Math.min(MEMBER_PAGE, members.length - memberLimit)} more…
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function Stats({ stats }: { stats: Report["stats"] }) {
  const pct = stats.totalTags ? Math.round((100 * stats.otherTags) / stats.totalTags) : 0;
  const after = stats.totalTags ? Math.round((100 * stats.otherAfterAccepting) / stats.totalTags) : 0;
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 px-3 py-2.5 text-xs text-neutral-400 space-y-1">
      <p>
        <strong className="text-neutral-200">{stats.otherTags.toLocaleString()}</strong> of{" "}
        {stats.totalTags.toLocaleString()} tags sit in Other ({pct}%). Accepting every tag card below takes that to{" "}
        <strong className="text-neutral-200">{stats.otherAfterAccepting.toLocaleString()}</strong> ({after}%), moving{" "}
        {stats.tagsCovered.toLocaleString()} tags across {stats.itemsAffected.toLocaleString()} catalog appearances.
      </p>
      <p>
        {stats.franchises.toLocaleString()} franchises, {stats.singletonFranchises.toLocaleString()} of them holding a
        single title.
        {stats.dismissed > 0 && ` ${stats.dismissed} suggestion${stats.dismissed === 1 ? "" : "s"} denied and hidden.`}
      </p>
      <p className="text-neutral-600">
        The tail is the long part: nearly every tag left in Other after this appears three times or fewer in the whole
        catalog. Those are best handled with the Tags table&apos;s bulk select, not one card at a time.
      </p>
    </div>
  );
}

// ── tag batch ─────────────────────────────────────────────────────────────

function TagCardView({
  card, categories, busy, onAccept, onDeny,
}: {
  card: TagCard;
  categories: TagCategoryConfig[];
  busy: boolean;
  onAccept: (card: TagCard, tagKeys: string[], categoryId: string) => void;
  onDeny: () => void;
}) {
  const [target, setTarget] = useState(card.categoryId);
  const [expanded, setExpanded] = useState(false);
  // Unchecked rather than checked: the set starts as "everything", and picking
  // out the handful that do not belong is the job. Tracking the exclusions
  // means the count reads right without copying 155 keys into state.
  const [dropped, setDropped] = useState<Set<string>>(new Set());

  const keys = card.tags.filter((t) => !dropped.has(t.key)).map((t) => t.key);
  const targetLabel = categories.find((c) => c.id === target)?.label
    ?? (target === card.categoryId ? card.categoryLabel : target);

  return (
    <article className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3 space-y-2">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-sm text-neutral-100">{card.title}</h3>
          <p className="text-xs text-neutral-500 mt-0.5 max-w-2xl">{card.why}</p>
        </div>
        {/* `ml-auto` matters on the wrapped layout: once this drops onto its own
            line, justify-between has nothing to push it against and it would sit
            at the start, reading like a stray indent under the title. */}
        <div className="ml-auto text-right shrink-0 text-xs text-neutral-500">
          <div className="text-neutral-300">→ {targetLabel}</div>
          <div>{card.tags.length} tags · {card.itemsAffected.toLocaleString()} appearances</div>
          {card.createsCategory && (
            <div className="text-amber-500/80">creates this category</div>
          )}
        </div>
      </div>

      {/* ⚠️ Chips are ALWAYS clickable. They were gated on `expanded` first, and
          the expander only exists once a card holds more than 14 tags — so on a
          card of seven the chips rendered disabled with no way to enable them,
          and "correct it right away" quietly did not exist for the small cards.
          Expanding controls how many are SHOWN, and nothing else. */}
      <div className="flex flex-wrap items-center gap-1">
        {(expanded ? card.tags : card.tags.slice(0, 14)).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setDropped((d) => {
              const n = new Set(d);
              if (!n.delete(t.key)) n.add(t.key);
              return n;
            })}
            title={dropped.has(t.key) ? `Put "${t.label}" back` : `Leave "${t.label}" out of this batch`}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs transition-colors hover:bg-neutral-700 ${
              dropped.has(t.key)
                ? "bg-neutral-900 text-neutral-600 line-through"
                : "bg-neutral-800 text-neutral-300"
            }`}
          >
            {t.label}
            <span className="text-neutral-600">{t.count}×</span>
          </button>
        ))}
        {!expanded && card.tags.length > 14 && (
          <button type="button" onClick={() => setExpanded(true)}
            className="px-1.5 py-0.5 text-xs text-neutral-500 hover:text-neutral-200 underline decoration-dotted">
            +{card.tags.length - 14} more
          </button>
        )}
        <span className="text-[11px] text-neutral-600 pl-1">click one to leave it out</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        <button onClick={() => onAccept(card, keys, target)} disabled={busy || keys.length === 0} className={primaryBtn}>
          {busy ? "Applying…" : `Accept ${keys.length}`}
        </button>
        <label className="flex items-center gap-1.5 text-xs text-neutral-500">
          into
          <select value={target} onChange={(e) => setTarget(e.target.value)} disabled={busy} className={`${inputCls} text-xs py-0.5`}>
            {/* A proposed category has no row yet, so it cannot come from the
                live list. Offering it here is what makes "accept, but into
                something else" possible without leaving the screen. */}
            {card.createsCategory && !categories.some((c) => c.id === card.createsCategory!.id) && (
              <option value={card.createsCategory.id}>{card.createsCategory.label} (new)</option>
            )}
            {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        {dropped.size > 0 && (
          <span className="text-xs text-neutral-600">{dropped.size} left out</span>
        )}
        <button onClick={onDeny} disabled={busy} className={`${ghostBtn} ml-auto`}>Deny</button>
      </div>
    </article>
  );
}

// ── franchise merge ───────────────────────────────────────────────────────

function MergeCardView({
  card, busy, onBundle, onDeny,
}: {
  card: MergeCard;
  busy: boolean;
  onBundle: (ref: string, aliasKey: string, canonicalKey: string) => void;
  onDeny: () => void;
}) {
  return (
    <article className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3 space-y-2">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <h3 className="text-sm text-neutral-100">
          {card.aliasLabel} <span className="text-neutral-600">({card.aliasSize})</span>
          <span className="text-neutral-500"> → </span>
          {card.canonicalLabel} <span className="text-neutral-600">({card.canonicalSize})</span>
        </h3>
      </div>
      <p className="text-xs text-neutral-500">{card.why}</p>

      {/* Titles from both sides. The merge signals produce real false positives
          ("Portal" against "Portal Knights" is two unrelated games), and the
          names alone are not enough to tell one from the other. */}
      <div className="grid gap-2 sm:grid-cols-2 text-xs text-neutral-600">
        <div>
          <div className="text-neutral-500 mb-0.5">{card.aliasLabel}</div>
          {card.aliasSample.join(" · ") || "—"}
        </div>
        <div>
          <div className="text-neutral-500 mb-0.5">{card.canonicalLabel}</div>
          {card.canonicalSample.join(" · ") || "—"}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => onBundle(card.ref, card.aliasKey, card.canonicalKey)} disabled={busy} className={primaryBtn}>
          {busy ? "Bundling…" : `Bundle into ${card.canonicalLabel}`}
        </button>
        {/* The correction this card needs: which of the two is the franchise.
            The suggestion guesses from size and generality, and it guesses
            wrong whenever the sub-series is the better-known name. */}
        <button onClick={() => onBundle(card.ref, card.canonicalKey, card.aliasKey)} disabled={busy} className={ghostBtn}>
          Other way: into {card.aliasLabel}
        </button>
        <button onClick={onDeny} disabled={busy} className={`${ghostBtn} ml-auto`}>Deny</button>
      </div>
    </article>
  );
}

// ── franchise membership ──────────────────────────────────────────────────

function MemberCardView({
  card, busy, franchiseLabels, onAttach, onDeny,
}: {
  card: MemberCard;
  busy: boolean;
  franchiseLabels: string[];
  onAttach: (ref: string, mediaItemId: string, label: string) => void;
  onDeny: () => void;
}) {
  const [label, setLabel] = useState(card.ipLabel);
  const listId = `fr-${card.mediaItemId}`;

  return (
    <article className="rounded-lg border border-neutral-800 bg-neutral-950/40 px-3 py-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <span className="text-neutral-100 min-w-0 truncate max-w-[14rem]" title={card.itemTitle}>{card.itemTitle}</span>
      <span className="text-[10px] uppercase tracking-wide text-neutral-600">{card.itemType}</span>
      <span className="text-neutral-600">→</span>
      {/* Free text with a datalist rather than a fixed picker: `attach` takes a
          LABEL and derives the key from it, so typing a franchise that does not
          exist yet creates it, and picking one that does attaches to it. That
          makes one control both the corrector and the "none of these" escape. */}
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        list={listId}
        disabled={busy}
        className={`${inputCls} text-xs py-0.5 w-48`}
        aria-label={`Franchise for ${card.itemTitle}`}
      />
      <datalist id={listId}>
        {franchiseLabels.map((l) => <option key={l} value={l} />)}
      </datalist>
      <span className="text-xs text-neutral-600">{card.franchiseSize} titles</span>
      {/* One group, so a wrap moves both buttons together. Left loose, `ml-auto`
          on Add alone drops Deny onto a line of its own and every row in the
          list ends up a different height. */}
      <div className="flex items-center gap-2 ml-auto shrink-0">
        <button
          onClick={() => onAttach(card.ref, card.mediaItemId, label.trim())}
          disabled={busy || !label.trim()}
          className={primaryBtn}
        >
          {busy ? "Adding…" : "Add"}
        </button>
        <button onClick={onDeny} disabled={busy} className={ghostBtn}>Deny</button>
      </div>
    </article>
  );
}
