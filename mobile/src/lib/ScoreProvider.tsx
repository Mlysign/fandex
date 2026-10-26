// Your taste profile, built on the device, and the Fandex Scores that come out
// of it.
//
// The maths is fandexScore.ts. This file gathers its three inputs (the titles
// you rated, with their facets, out of SQLite; the taxonomy, from the Worker,
// kept in SQLite so it works offline) and rebuilds the profile when any of them
// changes: a rating, a catalog sync, a taxonomy edit.
//
// A score is a per-user number, so there is none when signed out, and none
// below three rated titles (the site's rule: no number rather than one built on
// two samples).

import { useSQLiteContext } from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { api, type ScoreReport } from '~/lib/api';
import { useAuth } from '~/lib/AuthProvider';
import { useCatalogSync } from '~/lib/CatalogSyncProvider';
import { API_URL, CATALOG_FILES_URL } from '~/lib/config';
import { getMeta, setMeta } from '~/lib/db';
import { impactAbsence, pageImpacts, type ImpactKind, type PageImpact } from '~/lib/facetImpact';
import {
  buildProfile, catalogCountsFrom, computeFandexScore, prepareTaxonomy, WISHLIST_WEIGHT,
  type AxisBand, type CatalogCounts, type ConsumedTitle, type FandexScore, type FollowMode, type Profile, type RatedTitle, type ReferenceJson, type ScoreFacet, type ScoreLabel, type Taxonomy, type TaxonomyJson,
} from '~/lib/fandexScore';

const TAXONOMY_KEY = 'taxonomy';
const TAXONOMY_ETAG_KEY = 'taxonomy_etag';
const TAXONOMY_AT_KEY = 'taxonomy_at';
// The reference population (docs/fandex-score.md §3.7), a file the website's
// build writes once a week next to the catalog files. Kept here like the
// taxonomy and asked for again daily. An app pointed at another API has no
// such file (CATALOG_FILES_URL is null) and measures pull against its own copy.
const REFERENCE_KEY = 'reference_population';
const REFERENCE_ETAG_KEY = 'reference_population_etag';
const REFERENCE_AT_KEY = 'reference_population_at';
const REFERENCE_CHECK_GAP_MS = 24 * 60 * 60 * 1000;
/**
 * Asked on every start and every return to the app, at most once a minute (a
 * browser fires "active" on every tab switch). An unchanged taxonomy is a 304
 * off one kept row on the Worker (worker/src/catalog/read.ts), so asking often
 * is cheap; asking twice a day left a sweep invisible for up to twelve hours.
 */
const TAXONOMY_CHECK_GAP_MS = 60_000;
/** Host parameters per statement, kept well under any SQLite build's limit. */
const ID_CHUNK = 200;

interface Scores {
  /** False until the first attempt to build a profile has finished. */
  ready: boolean;
  /** Your mean rating × 10, or null when there is no score to show. */
  center: number | null;
  /** Category id → its name, for the breakdown. */
  categoryLabel: (id: string | undefined) => string | null;
  /** Tag categories, bundles and chosen names. Null until the first one has loaded. */
  taxonomy: Taxonomy | null;
  /** Score one title from its raw facets. `type` is its medium, for the pull weight. Null when there is no profile or nothing matches. */
  score: (id: string, facets: ScoreFacet[], type?: string) => FandexScore | null;
  /**
   * Scores for catalog titles by id, read off the device. Titles with no score are absent.
   * `alive` is asked between chunks: a caller whose answer is no longer wanted stops the work
   * there, and gets what was scored so far.
   */
  scoresFor: (ids: string[], alive?: () => boolean) => Promise<Map<string, RowScore>>;
  /** What a tag, person, studio or franchise does to your score, for its page. `key` as the address spells it. Empty when it does nothing. */
  impactsFor: (kind: ImpactKind, key: string) => PageImpact[];
  /** Why `impactsFor` is empty, in words, or null when it is not (or nobody is signed in). */
  impactAbsenceFor: (kind: ImpactKind, key: string, name: string) => string | null;
  /** Bumped when the profile is rebuilt, so a list can re-score. */
  revision: number;
  /** What you follow or avoid, by facet id, as the profile last read it. */
  follows: ReadonlyMap<string, FollowMode>;
  /** Fetch the taxonomy again now. The Scoring admin calls it after a save, so its own edit shows at once. */
  reloadTaxonomy: () => Promise<void>;
  /** Use a taxonomy the Worker just answered a write with, without asking for it again. */
  adoptTaxonomy: (json: TaxonomyJson) => Promise<void>;
}

/** What a list row needs of a score: the number that ranks it, the label the card shows, and the two bands behind it. */
export interface RowScore { score: number; label: ScoreLabel; taste: AxisBand; pull: AxisBand | null }

const Ctx = createContext<Scores | null>(null);
const NO_FOLLOWS: ReadonlyMap<string, FollowMode> = new Map();

export function parseFacets(json: string): ScoreFacet[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? (v as ScoreFacet[]) : [];
  } catch {
    return [];
  }
}

async function storedTaxonomy(db: SQLiteDatabase): Promise<Taxonomy | null> {
  const raw = await getMeta(db, TAXONOMY_KEY);
  if (!raw) return null;
  try { return prepareTaxonomy(JSON.parse(raw) as TaxonomyJson); } catch { return null; }
}

/** Ask for the taxonomy unless it was asked for under a minute ago. True when a new one was stored. Never throws: the stored one stands. */
async function refreshTaxonomy(db: SQLiteDatabase, force: boolean): Promise<boolean> {
  const at = Number(await getMeta(db, TAXONOMY_AT_KEY)) || 0;
  if (!force && Date.now() - at < TAXONOMY_CHECK_GAP_MS) return false;
  try {
    const etag = await getMeta(db, TAXONOMY_ETAG_KEY);
    const res = await fetch(`${API_URL}/v1/taxonomy`, { headers: etag ? { 'If-None-Match': etag } : {} });
    if (res.status === 304) { await setMeta(db, TAXONOMY_AT_KEY, String(Date.now())); return false; }
    if (!res.ok) return false;
    const body = await res.text();
    prepareTaxonomy(JSON.parse(body) as TaxonomyJson); // Throws on a body that is not a taxonomy, before anything is stored.
    await setMeta(db, TAXONOMY_KEY, body);
    await setMeta(db, TAXONOMY_ETAG_KEY, res.headers.get('etag') ?? '');
    await setMeta(db, TAXONOMY_AT_KEY, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

/** The stored reference population, or null when the device has none (or it does not parse). */
export async function storedReference(db: SQLiteDatabase): Promise<ReferenceJson | null> {
  const raw = await getMeta(db, REFERENCE_KEY);
  if (!raw) return null;
  try {
    const json = JSON.parse(raw) as ReferenceJson;
    return json && typeof json === 'object' && json.media && typeof json.media === 'object' ? json : null;
  } catch { return null; }
}

/**
 * Ask the website for the reference population unless it was asked for in the
 * last day. True when a new one was stored. Never throws: the stored one, or
 * none, stands, and the score then measures pull against the device's own copy.
 */
export async function refreshReference(db: SQLiteDatabase): Promise<boolean> {
  if (CATALOG_FILES_URL === null) return false;
  const at = Number(await getMeta(db, REFERENCE_AT_KEY)) || 0;
  if (Date.now() - at < REFERENCE_CHECK_GAP_MS) return false;
  try {
    const etag = await getMeta(db, REFERENCE_ETAG_KEY);
    const res = await fetch(`${CATALOG_FILES_URL}/catalog/reference.json`, { headers: etag ? { 'If-None-Match': etag } : {} });
    if (res.status === 304) { await setMeta(db, REFERENCE_AT_KEY, String(Date.now())); return false; }
    if (!res.ok) return false;
    const body = await res.text();
    const json = JSON.parse(body) as ReferenceJson;
    if (!json?.media || typeof json.media !== 'object' || !Object.keys(json.media).length) return false;
    await setMeta(db, REFERENCE_KEY, body);
    await setMeta(db, REFERENCE_ETAG_KEY, res.headers.get('etag') ?? '');
    await setMeta(db, REFERENCE_AT_KEY, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

export async function ratedTitles(db: SQLiteDatabase): Promise<RatedTitle[]> {
  // Your rating for a title is the average of the per-provider scores above
  // zero, to one decimal: the rule the Library list and the site both use.
  const rows = await db.getAllAsync<{ id: string; type: string; rating: number; facets: string }>(
    `SELECT c.id, c.type, ROUND(AVG(s.rating), 1) AS rating, c.facets
       FROM item_state s JOIN catalog c ON c.id = s.media_item_id
      WHERE s.relation = 'library' AND s.rating > 0
      GROUP BY c.id`,
  );
  return rows.map((r) => ({ id: r.id, type: r.type, rating: r.rating, facets: parseFacets(r.facets) }));
}

/**
 * The titles you consumed, for the pull axis: everything in your library at
 * full weight, rated or not, and what you only wishlisted at `WISHLIST_WEIGHT`.
 * A rating is not asked for here: pull is about what you chose, not what you
 * thought of it (docs/fandex-score.md §3.7).
 */
export async function consumedTitles(db: SQLiteDatabase): Promise<ConsumedTitle[]> {
  const rows = await db.getAllAsync<{ id: string; facets: string; held: number }>(
    `SELECT c.id, c.facets, MAX(CASE WHEN s.relation = 'library' THEN 1 ELSE 0 END) AS held
       FROM item_state s JOIN catalog c ON c.id = s.media_item_id
      WHERE s.relation IN ('library', 'wishlist')
      GROUP BY c.id`,
  );
  return rows.map((r) => ({ id: r.id, facets: parseFacets(r.facets), weight: r.held ? 1 : WISHLIST_WEIGHT }));
}

const REPORT_AT_KEY = 'score_report_at';
const REPORT_SIG_KEY = 'score_report_sig';
/** A report goes out at most this often, unless the rated count moved by `REPORT_RATED_STEP` since the last one. */
const REPORT_GAP_MS = 24 * 60 * 60 * 1000;
const REPORT_RATED_STEP = 10;
const BIN_FROM = -6;
const BIN_COUNT = 12;

/**
 * The score's goalpost (worker/src/scoreReport.ts): for every title you rated,
 * scored with your rating left out, the gap between your rating and the match,
 * and the label it got. Sent as counts per medium, about once a day. Nothing
 * here names a title or carries a rating, and a send that fails is not worth a
 * word: the next rebuild tries again.
 */
export async function sendScoreReport(db: SQLiteDatabase, rated: RatedTitle[], profile: Profile, tax: Taxonomy): Promise<boolean> {
  try {
    const sig = `${rated.length}|${tax.config.pullGain}|${tax.config.tasteBandMargin}`;
    const at = Number(await getMeta(db, REPORT_AT_KEY)) || 0;
    const last = (await getMeta(db, REPORT_SIG_KEY)) ?? '';
    const lastRated = Number(last.split('|')[0]) || 0;
    if (Date.now() - at < REPORT_GAP_MS && Math.abs(rated.length - lastRated) < REPORT_RATED_STEP) return false;
    const per = new Map<string, ScoreReport>();
    for (const r of rated) {
      if (!r.type) continue;
      const fx = computeFandexScore(r.facets, r.id, profile, tax, r.type);
      if (!fx) continue;
      let rep = per.get(r.type);
      if (!rep) per.set(r.type, (rep = { medium: r.type, rated: 0, bins: new Array<number>(BIN_COUNT).fill(0), labels: {} }));
      rep.rated++;
      const bin = Math.max(0, Math.min(BIN_COUNT - 1, Math.round(r.rating - fx.score / 10) - BIN_FROM));
      rep.bins[bin]++;
      const pair = rep.labels[fx.label] ?? (rep.labels[fx.label] = [0, 0]);
      pair[0]++;
      if (r.rating >= 8) pair[1]++;
    }
    if (!per.size) return false;
    await api.scoreReport([...per.values()]);
    await setMeta(db, REPORT_AT_KEY, String(Date.now()));
    await setMeta(db, REPORT_SIG_KEY, sig);
    return true;
  } catch {
    return false;
  }
}

/** What you follow or avoid, by the score's facet id, off this device (lib/stateSync.ts keeps it in step with the Worker). */
export async function followedFacets(db: SQLiteDatabase): Promise<Map<string, FollowMode>> {
  const rows = await db.getAllAsync<{ facet_id: string; mode: string }>('SELECT facet_id, mode FROM facet_follow');
  return new Map(rows.map((r) => [r.facet_id, r.mode === 'avoid' ? 'avoid' : 'follow']));
}

/**
 * The catalog copy's facet counts: the pull axis's denominator, measured
 * against the reference population where the device holds one (§3.7). Every
 * row is read, so a caller caches this by catalog revision.
 */
export async function catalogCounts(db: SQLiteDatabase, tax: Taxonomy, reference: ReferenceJson | null = null): Promise<CatalogCounts> {
  const rows = await db.getAllAsync<{ id: string; type: string; facets: string }>('SELECT id, type, facets FROM catalog');
  return catalogCountsFrom(rows.map((r) => ({ id: r.id, type: r.type, facets: parseFacets(r.facets) })), tax, reference);
}

export function ScoreProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const auth = useAuth();
  const catalog = useCatalogSync();
  const [taxonomy, setTaxonomy] = useState<Taxonomy | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);
  const [revision, setRevision] = useState(0);

  // The reference population: what is stored, then asked for again once a day.
  // Only its identity is kept in state; the counts read the stored file.
  const [reference, setReference] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const stored = await storedReference(db);
      if (live && stored) setReference(stored.builtAt);
      if (await refreshReference(db)) {
        const fresh = await storedReference(db);
        if (live && fresh) setReference(fresh.builtAt);
      }
    })();
    return () => { live = false; };
  }, [db]);

  // The taxonomy: what is stored, at once; then asked for again, on start and
  // on every return to the app, so an edit or a sweep shows on the next open.
  useEffect(() => {
    let live = true;
    const check = async () => {
      if (await refreshTaxonomy(db, false)) {
        const fresh = await storedTaxonomy(db);
        if (live && fresh) setTaxonomy(fresh);
      }
    };
    (async () => {
      const stored = await storedTaxonomy(db);
      if (!live) return;
      if (stored) setTaxonomy(stored);
      if (!stored && (await refreshTaxonomy(db, true))) {
        const fresh = await storedTaxonomy(db);
        if (live && fresh) setTaxonomy(fresh);
      } else if (stored) {
        await check();
      }
    })();
    const sub = AppState.addEventListener('change', (next) => { if (next === 'active') void check(); });
    return () => { live = false; sub.remove(); };
  }, [db]);

  // The profile: rebuilt when your rows, the catalog copy or the taxonomy change.
  // Not while the catalog copy is filling: a rated title only counts once its
  // catalog row has landed, so a fresh tab built five profiles in seven seconds
  // (0, 197, 796, 1517, 1707 titles) and every score moved under the reader.
  // The last whole profile stands until the fill ends; a device with none shows
  // no score until then, rather than one built on a fraction of its ratings.
  // Only a fill waits: the delta every start asks for runs on a whole copy, and
  // waiting for it kept Home's Recommended rail on its skeleton for as long as
  // the request took (RV31, 2026-10-23).
  const signedIn = auth.status === 'signedIn';
  const filling = catalog.filling;
  // The catalog's facet counts are read once per catalog revision and taxonomy,
  // not once per rating: counting means parsing every row's facets, which is
  // seconds on a phone, and a rating changes none of it.
  const counts = useRef<{ revision: number; tax: Taxonomy; reference: string | null; counts: CatalogCounts } | null>(null);
  useEffect(() => {
    let live = true;
    if (!signedIn || !taxonomy) {
      setProfile(null);
      if (auth.status !== 'loading') setReady(true);
      return;
    }
    if (filling) return;
    (async () => {
      const started = Date.now();
      const [rated, consumed, follows] = await Promise.all([ratedTitles(db), consumedTitles(db), followedFacets(db)]);
      if (!live) return;
      let cached = counts.current;
      if (!cached || cached.revision !== catalog.revision || cached.tax !== taxonomy || cached.reference !== reference) {
        cached = { revision: catalog.revision, tax: taxonomy, reference, counts: await catalogCounts(db, taxonomy, reference ? await storedReference(db) : null) };
        if (!live) return;
        counts.current = cached;
      }
      const built = buildProfile(rated, taxonomy, { consumed, catalog: cached.counts, follows });
      console.log('fandex_profile', JSON.stringify({ rated: rated.length, consumed: consumed.length, follows: follows.size, catalog: cached.counts.total, reference: cached.counts.referenceMedia ?? null, facets: built.w.size, ms: Date.now() - started }));
      setProfile(built);
      setReady(true);
      setRevision((r) => r + 1);
      // The goalpost, after the profile is in use: a report of how the match fits your own ratings, about once a day.
      setTimeout(() => { if (live) void sendScoreReport(db, rated, built, taxonomy); }, 2_000);
    })();
    return () => { live = false; };
  }, [db, signedIn, auth.status, taxonomy, reference, auth.rowsRevision, catalog.revision, filling]);

  const score = useCallback((id: string, facets: ScoreFacet[], type?: string) =>
    (profile && taxonomy ? computeFandexScore(facets, id, profile, taxonomy, type) : null), [profile, taxonomy]);

  const scoresFor = useCallback(async (ids: string[], alive?: () => boolean) => {
    const out = new Map<string, RowScore>();
    if (!profile || !taxonomy || !ids.length) return out;
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      if (alive && !alive()) break;
      const chunk = ids.slice(i, i + ID_CHUNK);
      const rows = await db.getAllAsync<{ id: string; type: string; facets: string }>(
        `SELECT id, type, facets FROM catalog WHERE id IN (${chunk.map(() => '?').join(',')})`, chunk,
      );
      for (const r of rows) {
        const fx = computeFandexScore(parseFacets(r.facets), r.id, profile, taxonomy, r.type);
        if (fx) out.set(r.id, { score: fx.score, label: fx.label, taste: fx.taste.band, pull: fx.pull?.band ?? null });
      }
    }
    return out;
  }, [db, profile, taxonomy]);

  const impactsFor = useCallback((kind: ImpactKind, key: string) =>
    (profile && taxonomy ? pageImpacts(kind, key, profile, taxonomy) : []), [profile, taxonomy]);
  const impactAbsenceFor = useCallback((kind: ImpactKind, key: string, name: string) =>
    (signedIn ? impactAbsence(kind, key, profile, taxonomy, name) : null), [signedIn, profile, taxonomy]);

  const reloadTaxonomy = useCallback(async () => {
    await refreshTaxonomy(db, true);
    const fresh = await storedTaxonomy(db);
    if (fresh) setTaxonomy(fresh);
  }, [db]);

  const adoptTaxonomy = useCallback(async (json: TaxonomyJson) => {
    const next = prepareTaxonomy(json);
    await setMeta(db, TAXONOMY_KEY, JSON.stringify(json));
    // The stored ETag no longer describes what is stored. Dropping it makes the next check a full fetch.
    await setMeta(db, TAXONOMY_ETAG_KEY, '');
    setTaxonomy(next);
  }, [db]);

  const value = useMemo<Scores>(() => {
    // The same rounding the score itself uses, so the two never disagree by a tenth.
    const center = profile && profile.w.size > 0 && profile.ratedItemCount >= 3 ? Math.round(profile.baseline * 100) / 10 : null;
    return {
      ready, center, score, scoresFor, impactsFor, impactAbsenceFor, revision, taxonomy, reloadTaxonomy, adoptTaxonomy,
      follows: profile?.follows ?? NO_FOLLOWS,
      categoryLabel: (id) => (id ? taxonomy?.categories.get(id)?.label ?? null : null),
    };
  }, [ready, profile, taxonomy, score, scoresFor, impactsFor, impactAbsenceFor, revision, reloadTaxonomy, adoptTaxonomy]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useScores(): Scores {
  const v = useContext(Ctx);
  if (!v) throw new Error('useScores must be used inside <ScoreProvider>');
  return v;
}

/** The scores for a list's rows, re-read when the rows or the profile change. */
export function useRowScores(ids: string[]): Map<string, RowScore> {
  const { scoresFor, revision } = useScores();
  const [scores, setScores] = useState<Map<string, RowScore>>(new Map());
  const key = ids.join(',');
  useEffect(() => {
    let live = true;
    void scoresFor(key ? key.split(',') : []).then((s) => { if (live) setScores(s); });
    return () => { live = false; };
  }, [key, scoresFor, revision]);
  return scores;
}
