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
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '~/lib/AuthProvider';
import { useCatalogSync } from '~/lib/CatalogSyncProvider';
import { API_URL } from '~/lib/config';
import { getMeta, setMeta } from '~/lib/db';
import {
  buildProfile, computeFandexScore, prepareTaxonomy,
  type FandexScore, type Profile, type RatedTitle, type ScoreFacet, type Taxonomy, type TaxonomyJson,
} from '~/lib/fandexScore';

const TAXONOMY_KEY = 'taxonomy';
const TAXONOMY_ETAG_KEY = 'taxonomy_etag';
const TAXONOMY_AT_KEY = 'taxonomy_at';
/** The taxonomy is edited by hand, rarely. Asking twice a day is plenty, and an unchanged one costs a 304. */
const TAXONOMY_TTL_MS = 12 * 60 * 60 * 1000;
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
  /** Score one title from its raw facets. Null when there is no profile or nothing matches. */
  score: (id: string, facets: ScoreFacet[]) => FandexScore | null;
  /** Scores for catalog titles by id, read off the device. Titles with no score are absent. */
  scoresFor: (ids: string[]) => Promise<Map<string, number>>;
  /** Bumped when the profile is rebuilt, so a list can re-score. */
  revision: number;
}

const Ctx = createContext<Scores | null>(null);

function parseFacets(json: string): ScoreFacet[] {
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

/** Fetch the taxonomy if the stored one is old. True when a new one was stored. Never throws: the stored one stands. */
async function refreshTaxonomy(db: SQLiteDatabase, force: boolean): Promise<boolean> {
  const at = Number(await getMeta(db, TAXONOMY_AT_KEY)) || 0;
  if (!force && Date.now() - at < TAXONOMY_TTL_MS) return false;
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

async function ratedTitles(db: SQLiteDatabase): Promise<RatedTitle[]> {
  // Your rating for a title is the average of the per-provider scores above
  // zero, to one decimal: the rule the Library list and the site both use.
  const rows = await db.getAllAsync<{ id: string; rating: number; facets: string }>(
    `SELECT c.id, ROUND(AVG(s.rating), 1) AS rating, c.facets
       FROM item_state s JOIN catalog c ON c.id = s.media_item_id
      WHERE s.relation = 'library' AND s.rating > 0
      GROUP BY c.id`,
  );
  return rows.map((r) => ({ id: r.id, rating: r.rating, facets: parseFacets(r.facets) }));
}

export function ScoreProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const auth = useAuth();
  const catalog = useCatalogSync();
  const [taxonomy, setTaxonomy] = useState<Taxonomy | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);
  const [revision, setRevision] = useState(0);

  // The taxonomy: what is stored, at once; then a fresher one if it is due.
  useEffect(() => {
    let live = true;
    (async () => {
      const stored = await storedTaxonomy(db);
      if (!live) return;
      if (stored) setTaxonomy(stored);
      if (await refreshTaxonomy(db, !stored)) {
        const fresh = await storedTaxonomy(db);
        if (live && fresh) setTaxonomy(fresh);
      }
    })();
    return () => { live = false; };
  }, [db]);

  // The profile: rebuilt when your rows, the catalog copy or the taxonomy change.
  const signedIn = auth.status === 'signedIn';
  useEffect(() => {
    let live = true;
    if (!signedIn || !taxonomy) {
      setProfile(null);
      if (auth.status !== 'loading') setReady(true);
      return;
    }
    (async () => {
      const started = Date.now();
      const rated = await ratedTitles(db);
      if (!live) return;
      const built = buildProfile(rated, taxonomy);
      console.log('fandex_profile', JSON.stringify({ rated: rated.length, facets: built.w.size, ms: Date.now() - started }));
      setProfile(built);
      setReady(true);
      setRevision((r) => r + 1);
    })();
    return () => { live = false; };
  }, [db, signedIn, auth.status, taxonomy, auth.rowsRevision, catalog.revision]);

  const score = useCallback((id: string, facets: ScoreFacet[]) =>
    (profile && taxonomy ? computeFandexScore(facets, id, profile, taxonomy) : null), [profile, taxonomy]);

  const scoresFor = useCallback(async (ids: string[]) => {
    const out = new Map<string, number>();
    if (!profile || !taxonomy || !ids.length) return out;
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      const chunk = ids.slice(i, i + ID_CHUNK);
      const rows = await db.getAllAsync<{ id: string; facets: string }>(
        `SELECT id, facets FROM catalog WHERE id IN (${chunk.map(() => '?').join(',')})`, chunk,
      );
      for (const r of rows) {
        const fx = computeFandexScore(parseFacets(r.facets), r.id, profile, taxonomy);
        if (fx) out.set(r.id, fx.score);
      }
    }
    return out;
  }, [db, profile, taxonomy]);

  const value = useMemo<Scores>(() => {
    // The same rounding the score itself uses, so the two never disagree by a tenth.
    const center = profile && profile.w.size > 0 && profile.ratedItemCount >= 3 ? Math.round(profile.baseline * 100) / 10 : null;
    return {
      ready, center, score, scoresFor, revision, taxonomy,
      categoryLabel: (id) => (id ? taxonomy?.categories.get(id)?.label ?? null : null),
    };
  }, [ready, profile, taxonomy, score, scoresFor, revision]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useScores(): Scores {
  const v = useContext(Ctx);
  if (!v) throw new Error('useScores must be used inside <ScoreProvider>');
  return v;
}

/** The scores for a list's rows, re-read when the rows or the profile change. */
export function useRowScores(ids: string[]): Map<string, number> {
  const { scoresFor, revision } = useScores();
  const [scores, setScores] = useState<Map<string, number>>(new Map());
  const key = ids.join(',');
  useEffect(() => {
    let live = true;
    void scoresFor(key ? key.split(',') : []).then((s) => { if (live) setScores(s); });
    return () => { live = false; };
  }, [key, scoresFor, revision]);
  return scores;
}
