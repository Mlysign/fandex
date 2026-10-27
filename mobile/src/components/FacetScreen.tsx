// A tag, a person, a studio or a franchise: what it is, how the crowd and you
// rate it, and every title in the catalog that carries it. The site's facet
// page (src/components/facet/PublicFacetView.tsx), from the catalog on the
// device.
//
// One page per person, tag, studio or franchise, as on the site: a person's
// page shows everything they worked on, whatever the role, `/studio` folds
// developer, publisher, studio and network together, and `/franchise` (since
// 2026-10-18) is the franchise after the taxonomy: bundles folded, hand-made
// attaches in, detaches out.
//
// Since 2026-10-18 the list can be narrowed: a row of media types under the
// numbers, and the same Filters sheet Search has (components/Filters.tsx).
// Nothing is narrowed until somebody taps, so a page opens as it always did.
//
// A franchise page opens with a carousel per series, the rest in the grid under
// them (lib/franchiseSeries.ts, 2026-10-18).
//
// Not carried over: "also known as" for a person.

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ArrowLeft } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { ipDisplayLabel } from '@/lib/facets';
import { slugToKey } from '@/lib/facetUrl';
import type { MediaType } from '@/types';
import { CardRail, PosterGrid, RailHeader } from '~/components/cards';
import { countActive, FilterSheet, FiltersButton, noFilters, useFiltered } from '~/components/Filters';
import { Avatar, EmptyState, SortMenu } from '~/components/kit';
import { backButtonStyle, FacetHeader, facetEyebrow, KIND_LABEL, ROLE_LABEL, type FacetKind } from '~/components/FacetHeader';
import { Screen, StateBlock } from '~/components/ui';
import { useAuth } from '~/lib/AuthProvider';
import { cardFromCatalog, useCardStates, type CardItem } from '~/lib/cards';
import { creditLine } from '~/lib/creditLine';
import { estimateFacets, spokenKey, type ImpactKind, type PageImpact } from '~/lib/facetImpact';
import { useCatalogSync } from '~/lib/CatalogSyncProvider';
import type { CatalogRow } from '~/lib/db';
import { useOfferedTypes } from '~/lib/features';
import { seriesOfFacet, splitSeries, type SeriesKey } from '~/lib/franchiseSeries';
import { usePageTitle } from '~/lib/pageTitle';
import { dropFacetPrerender } from '~/lib/prerender';
import { byPopularity, byRating } from '~/lib/sortCards';
import { longDate } from '~/lib/dates';
import { providerFacet, type FacetPerson } from '~/lib/facetProviders';
import { PhotoGallery } from '~/components/PhotoGallery';
import { count } from '~/lib/plural';
import { setFollow } from '~/lib/itemActions';
import { useRowScores, useScores } from '~/lib/ScoreProvider';
import { pullSentence, signed } from '~/lib/scoreReasons';
import { TYPE_ICONS } from '~/lib/typeIcons';
import { color, font, radius, type, TYPE_PLURAL } from '~/theme';

export type { FacetKind } from '~/components/FacetHeader';

type Sort = 'popularity' | 'releaseDate' | 'rating' | 'fandexScore';
const SORTS: [Sort, string][] = [['popularity', 'Popularity'], ['releaseDate', 'Release date'], ['rating', 'Rating'], ['fandexScore', 'Fandex Score']];

interface StoredFacet { kind: string; key: string; label: string; role?: string; category?: string; series?: string[] }

/** The profile's kind for a page's kind: a studio page reads `company` entries, a franchise page `ip`. */
const IMPACT_KIND: Record<FacetKind, ImpactKind> = { tag: 'tag', person: 'person', studio: 'company', franchise: 'ip' };

const IMPACT_TONE = {
  up: { backgroundColor: color.successSubtle, color: color.success },
  down: { backgroundColor: color.dangerSubtle, color: color.danger },
  neutral: { backgroundColor: color.surfaceElevated, color: color.textSecondary },
} as const;

/** The taste half, in a sentence. A person or a studio is scored per role, so theirs names the role. */
function impactLine(kind: FacetKind, im: PageImpact): string {
  const who = kind === 'tag' ? 'titles with this tag'
    : kind === 'franchise' ? 'titles in this franchise'
    : im.role === 'cast' ? 'titles with them in the cast'
    : `titles with them as ${(ROLE_LABEL[im.role ?? ''] ?? KIND_LABEL[kind]).toLowerCase()}`;
  const how = im.direction === 'up' ? 'you rate above your average'
    : im.direction === 'down' ? 'you rate below your average'
    : 'you rate about your average';
  return `${who} ${how} · ${im.ratedCount} rated`;
}

/** The pull half, in the Why sheet's words: "You pick anime 5 times more often than average (88 of your films)". */
function pullLine(kind: FacetKind, im: PageImpact, name: string): string | null {
  const p = im.pull;
  if (!p) return null;
  return pullSentence({ kind: kind === 'tag' ? 'tag' : kind === 'franchise' ? 'ip' : 'person', times: p.times, titles: p.titles, media: p.media, followed: p.followed }, name);
}

/** A row of media types under the numbers: tap one to keep that type, tap again to drop it, none kept shows every type. */
function TypeRow({ offered, kept, onToggle }: { offered: MediaType[]; kept: Set<string>; onToggle: (t: string) => void }) {
  return (
    <View style={styles.typeRow} accessibilityLabel="Show only these types">
      {offered.map((t) => {
        const Icon = TYPE_ICONS[t];
        const on = kept.has(t);
        return (
          <Pressable
            key={t} onPress={() => onToggle(t)} accessibilityRole="button" accessibilityLabel={TYPE_PLURAL[t] ?? t}
            accessibilityState={{ selected: on }} {...(Platform.OS === 'web' ? ({ 'aria-pressed': on } as object) : null)} hitSlop={2}
            style={({ pressed }) => [styles.typeChip, on && { backgroundColor: color.media[t], borderColor: color.media[t] }, pressed && { opacity: 0.7 }]}>
            {Icon ? <Icon size={14} color={on ? color.textOnAccent : color.textSecondary} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export function FacetScreen({ kind }: { kind: FacetKind }) {
  const params = useLocalSearchParams<{ key: string }>();
  const router = useRouter();
  const db = useSQLiteContext();
  const auth = useAuth();
  const sync = useCatalogSync();
  const { center, score, impactsFor, impactAbsenceFor, taxonomy, follows } = useScores();
  // The address says "christopher-nolan"; the catalog's key is "christopher nolan".
  // A franchise's address may spell a bundled name: its page is the franchise it is bundled into.
  const spoken = slugToKey(params.key ?? '');
  const key = kind === 'franchise' && taxonomy ? (taxonomy.ipAliases.get(spoken) ?? spoken) : spoken;
  const impacts = useMemo(() => impactsFor(IMPACT_KIND[kind], key), [impactsFor, kind, key]);
  const [sort, setSort] = useState<Sort>('popularity');
  const [bioOpen, setBioOpen] = useState(false);
  /** The photo the gallery is open on, or null while it is shut. */
  const [photoAt, setPhotoAt] = useState<number | null>(null);
  const [followBusy, setFollowBusy] = useState(false);
  const [found, setFound] = useState<{
    label: string; category: string | null; roles: string[]; cards: CardItem[];
    /** A franchise page's: each held title's provider keys that belong to this page, which its series are made of. */
    seriesKeys: Map<string, SeriesKey[]>;
  } | null>(null);
  // Narrowing: media types kept (none kept is every type), and the Filters sheet.
  const offered = useOfferedTypes();
  const [kept, setKept] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState(noFilters);
  const [sheet, setSheet] = useState(false);

  // The other keys this franchise page answers for: every name bundled into it.
  const memberKeys = useMemo(() => {
    if (kind !== 'franchise' || !taxonomy) return [key];
    return [key, ...[...taxonomy.ipAliases.entries()].filter(([, canonical]) => canonical === key).map(([alias]) => alias)];
  }, [kind, key, taxonomy]);
  // Titles attached to this franchise by hand, and titles detached from it.
  const overrides = useMemo(() => {
    const added: string[] = [];
    const removed = new Set<string>();
    if (kind === 'franchise' && taxonomy) {
      for (const [id, list] of taxonomy.ipOverrides) {
        for (const o of list) {
          if ((taxonomy.ipAliases.get(o.ipKey) ?? o.ipKey) !== key) continue;
          if (o.mode === 'add') added.push(id); else removed.add(id);
        }
      }
    }
    return { added, removed };
  }, [kind, key, taxonomy]);

  /** Does a stored facet belong on this page? */
  const matches = (f: StoredFacet) => {
    if (kind === 'franchise') return f.kind === 'ip' && memberKeys.includes(f.key);
    return spokenKey(f.key) === key && (kind === 'studio' ? f.kind === 'company' : f.kind === kind);
  };

  // Blank the page only when it becomes another page. A re-read for the same one
  // (the catalog copy changed: a rating brought a title in, a sync landed) keeps
  // the list on screen until the new one replaces it. Blanking it swapped the
  // grid for a loading screen and the new grid opened at the top: rating a card
  // threw you back up the page (Nils, 2026-10-18).
  const shownFor = useRef<string | null>(null);
  useEffect(() => {
    let live = true;
    if (shownFor.current !== `${kind}|${key}`) {
      shownFor.current = `${kind}|${key}`;
      setFound(null);
    }
    (async () => {
      // The key is inside a JSON column. LIKE narrows four thousand rows to a
      // handful; the parse below is what decides.
      // On the key's first word only: the rest may be stored with hyphens where the address has spaces.
      const patterns = memberKeys.map((k) => `%"key":"${(k.split(' ')[0] ?? '').replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      const columns = 'id, type, title, slug, poster_url, release_date, year, community_score, community_votes, facets';
      const rows = await db.getAllAsync<CatalogRow & { facets: string }>(
        `SELECT ${columns} FROM catalog WHERE ${patterns.map(() => "facets LIKE ? ESCAPE '\\'").join(' OR ')}`,
        patterns,
      );
      // A franchise's hand-attached titles carry no such facet; they are read by id.
      const attached = overrides.added.length
        ? await db.getAllAsync<CatalogRow & { facets: string }>(`SELECT ${columns} FROM catalog WHERE id IN (${overrides.added.map(() => '?').join(',')})`, overrides.added)
        : [];
      let label = '';
      let category: string | null = null;
      const roles = new Map<string, number>();
      const cards: CardItem[] = [];
      const seriesKeys = new Map<string, SeriesKey[]>();
      const seen = new Set<string>();
      for (const r of [...rows, ...attached]) {
        if (seen.has(r.id) || overrides.removed.has(r.id)) continue;
        let hit: StoredFacet[] = [];
        try { hit = (JSON.parse(r.facets) as StoredFacet[]).filter(matches); } catch { /* an unreadable row is not a match */ }
        if (!hit.length && !overrides.added.includes(r.id)) continue;
        seen.add(r.id);
        // A franchise's own spelling wins over a bundled one's ("Batman", not "The Dark Knight Collection").
        const own = hit.find((f) => f.key === key) ?? hit[0];
        if (own && (!label || own.key === key)) label = own.label;
        category ??= hit.find((f) => f.category)?.category ?? null;
        for (const f of hit) if (f.role) roles.set(f.role, (roles.get(f.role) ?? 0) + 1);
        // What they did on this one, under its name: "Director · Writer", "Author". A tag or a franchise has no role.
        // A franchise's facet says "ip" in its role, which is no credit.
        const had = kind === 'franchise' ? [] : hit.map((f) => f.role).filter((x): x is string => !!x);
        cards.push({ ...cardFromCatalog(r), role: creditLine(r.type, had), roles: had.length ? [...new Set(had)] : undefined });
        // A hand-attached title carries none of these, and so is in no series.
        if (kind === 'franchise') seriesKeys.set(r.id, hit.flatMap(seriesOfFacet));
      }
      if (kind === 'franchise') label = taxonomy?.labels.get(`ip|${key}`) ?? (label ? ipDisplayLabel(label) : '');
      if (live) setFound({ label, category, roles: [...roles.entries()].sort((a, b) => b[1] - a[1]).map(([r]) => r), cards, seriesKeys });
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, kind, key, memberKeys, overrides, sync.revision]);

  // What the providers have beyond the catalog copy. The device's rows show at once; these join them.
  const [more, setMore] = useState<{ cards: CardItem[]; person: FacetPerson | null } | null>(null);
  const [asking, setAsking] = useState(false);
  const label = found?.label ?? '';
  // The website's static copy of this page lies over the app until the app has the titles.
  useEffect(() => { if (found) dropFacetPrerender(); }, [found]);
  usePageTitle(label || null);
  const ready = found != null;
  useEffect(() => {
    setMore(null);
    if (!ready) return;
    const abort = new AbortController();
    setAsking(true);
    providerFacet(kind, key, label || key, abort.signal)
      .then((p) => { if (!abort.signal.aborted) setMore(p); })
      .catch(() => { /* offline or the providers down: the page is what the device holds */ })
      .finally(() => { if (!abort.signal.aborted) setAsking(false); });
    return () => abort.abort();
  }, [kind, key, label, ready]);

  const cards = useMemo(() => {
    const own = found?.cards;
    if (!own || !more) return own;
    // The same title is one card: by Fandex id where the Worker knows it, else by type, name and year.
    const ident = (c: CardItem) => `${c.type}|${c.title.toLowerCase().replace(/[^a-z0-9]+/g, '')}|${c.releaseDate?.slice(0, 4) ?? ''}`;
    const ids = new Set(own.map((c) => c.id));
    const names = new Set(own.map(ident));
    // The provider's copy of a title the device holds is dropped, but its credit
    // is kept: the device knows "Cast", TMDB knows "as Tony Stark".
    const twinRole = new Map<string, string>();
    for (const c of more.cards) {
      if (!c.role) continue;
      if (c.id) twinRole.set(`id:${c.id}`, c.role);
      twinRole.set(ident(c), c.role);
    }
    const credited = own.map((c) => {
      const r = (c.id && twinRole.get(`id:${c.id}`)) || twinRole.get(ident(c));
      return r && r !== c.role ? { ...c, role: r } : c;
    });
    return [...credited, ...more.cards.filter((c) => !(c.id && ids.has(c.id)) && !names.has(ident(c)))];
  }, [found, more]);
  const ids = useMemo(() => (cards ?? []).map((c) => c.id), [cards]);
  const stateOf = useCardStates(ids);
  const scores = useRowScores(useMemo(() => ids.filter((i): i is string => !!i), [ids]));

  // Every card with the score it can have: the catalog's for a title the device
  // holds, an estimate from this page's facet for one it does not.
  const scored = useMemo(() => (cards ?? []).map((c) => {
    if (c.id && scores.has(c.id)) return c;
    const estimate = center == null ? null : score(c.key, estimateFacets(kind, key, label || key, c.roles, c.genres), c.type);
    return estimate == null ? c : { ...c, fandexScore: estimate.score, match: { score: estimate.score, band: estimate.band } };
  }), [cards, scores, center, score, kind, key, label]);

  // Narrowed: the kept types, then the sheet's filters.
  const typed = useMemo(() => (kept.size ? scored.filter((c) => kept.has(c.type)) : scored), [scored, kept]);
  const filtered = useFiltered(typed, filters, stateOf);

  const sorted = useMemo(() => {
    const list = [...filtered];
    const crowdOf = (c: CardItem) => ({ type: c.type, score: c.communityScore, votes: c.communityVotes ?? 0 });
    const fandexOf = (c: CardItem) => (c.id ? scores.get(c.id)?.score : null) ?? c.fandexScore ?? -1;
    switch (sort) {
      case 'popularity': return byPopularity(list, crowdOf, true);
      case 'rating': return byRating(list, crowdOf);
      case 'fandexScore': return list.sort((a, b) => fandexOf(b) - fandexOf(a));
      case 'releaseDate': return list.sort((a, b) => ((b.releaseDate ?? '') < (a.releaseDate ?? '') ? -1 : 1));
    }
  }, [filtered, sort, scores]);

  // A franchise page: a carousel per provider series, the rest in the grid (lib/franchiseSeries.ts).
  // From the narrowed list, so the type row and the filters reach the carousels too.
  const split = useMemo(() => {
    if (kind !== 'franchise' || !found) return { series: [], rest: sorted };
    return splitSeries({
      cards: sorted,
      // A card the device does not hold came from the providers, asked by this franchise's name.
      // TMDB's collection matches that name exactly, so its films join the series. A game's
      // series is its IGDB collection, which a provider card does not carry: the grid.
      // Open Library's series search is loose (box sets, books ABOUT Harry Potter), so one
      // of its books joins only when the Worker holds it: the real ones are in the catalog,
      // the box sets are not. The device's copy may not have them all yet.
      seriesOf: (c) => (c.id && found.seriesKeys.get(c.id))
        || (c.type !== 'game' && (c.source === 'tmdb' || c.id) ? undefined : []),
      franchiseKey: key, franchiseLabel: found.label || key,
    });
  }, [kind, found, sorted, key]);

  const tiles = useMemo(() => {
    const all = cards ?? [];
    const crowd = all.filter((c) => c.communityScore != null);
    const mine = all.map((c) => stateOf(c.id).rating).filter((r): r is number => r != null && r > 0);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    return [
      { label: 'titles', value: String(all.length) },
      { label: 'crowd average', value: crowd.length ? (avg(crowd.map((c) => c.communityScore as number)) / 10).toFixed(1) : '-' },
      ...(auth.status === 'signedIn' ? [{ label: mine.length ? `your average · ${mine.length} rated` : 'your average', value: mine.length ? avg(mine).toFixed(1) : '-' }] : []),
    ];
  }, [cards, stateOf, auth.status]);

  // The site's like-for-like line (PublicFacetView, SM22): over the titles you
  // rated, your average against the crowd's average for those same titles.
  const delta = useMemo(() => {
    const pairs = (cards ?? [])
      .map((c) => ({ mine: stateOf(c.id).rating, crowd: c.communityScore }))
      .filter((p): p is { mine: number; crowd: number } => p.mine != null && p.mine > 0 && p.crowd != null);
    if (!pairs.length) return null;
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    return { n: pairs.length, d: avg(pairs.map((p) => p.mine)) - avg(pairs.map((p) => p.crowd / 10)) };
  }, [cards, stateOf]);

  // A tag's place in the taxonomy (the site's Q18): its category, and the
  // spellings bundled into it ("Also known as"). A franchise lists its bundled names the same way.
  const tagCategory = kind === 'tag' && taxonomy
    ? taxonomy.categories.get(taxonomy.tagCategoryOverrides.get(key) ?? found?.category ?? 'other')?.label ?? null
    : null;
  const akas = taxonomy
    ? kind === 'tag' ? [...taxonomy.tagAliases.entries()].filter(([alias, canon]) => spokenKey(canon) === key && spokenKey(alias) !== key).map(([alias]) => alias)
    : kind === 'franchise' ? memberKeys.slice(1)
    : []
    : [];

  // What a follow of this page is keyed by: the profile's own ids when you have rated the facet, else the
  // ids the catalog would file it under (one per role for a person or a studio).
  const foundRoles = found?.roles;
  const followIds = useMemo(() => {
    if (impacts.length) return impacts.map((im) => im.facetId);
    if (kind === 'tag') return [`tag||${key}`];
    if (kind === 'franchise') return [`ip|ip|${key}`];
    const roles = foundRoles?.length ? foundRoles : [kind === 'person' ? 'cast' : 'studio'];
    return roles.map((role) => `${kind === 'person' ? 'person' : 'company'}|${role}|${key}`);
  }, [impacts, kind, key, foundRoles]);

  if (!found) return <Screen wide><StateBlock loading /></Screen>;

  const person = more?.person ?? null;
  const name = found.label || person?.name || key.replace(/-/g, ' ');
  const life = person ? [person.birthday ? `Born ${longDate(person.birthday) ?? person.birthday}` : null, person.deathday ? `died ${longDate(person.deathday) ?? person.deathday}` : null, person.placeOfBirth].filter(Boolean).join(' · ') : '';
  const absence = impacts.length ? null : impactAbsenceFor(IMPACT_KIND[kind], key, name);
  const followMode = followIds.every((id) => follows.get(id) === 'follow') ? 'follow' : followIds.every((id) => follows.get(id) === 'avoid') ? 'avoid' : null;
  const narrowed = kept.size > 0 || countActive(filters) > 0;
  const typesHere = offered.filter((t) => scored.some((c) => c.type === t));
  const header = (
    <FacetHeader
      back={(
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/discover' as never))} accessibilityRole="button" accessibilityLabel="Back" hitSlop={8} style={backButtonStyle}>
          <ArrowLeft size={16} color={color.textSecondary} />
        </Pressable>
      )}
      eyebrow={facetEyebrow(kind, found.roles)}
      name={name}
      avatar={person?.profileUrl ? (
        // The portrait opens every photo TMDB holds of them (Nils, 2026-10-17).
        person.photos.length ? (
          <Pressable onPress={() => setPhotoAt(0)} accessibilityRole="button" accessibilityLabel={`${count(person.photos.length, 'photo')} of ${name}`}
            style={(s) => [{ borderRadius: 999 }, (s as { hovered?: boolean }).hovered && { opacity: 0.85 }]}>
            <Avatar src={person.profileUrl} name={name} size={84} />
            {person.photos.length > 1 ? <View style={styles.photoCount}><Text style={styles.photoCountText}>{person.photos.length}</Text></View> : null}
          </Pressable>
        ) : <Avatar src={person.profileUrl} name={name} size={84} />
      ) : null}
      life={life}
      bio={person?.biography ? (
        <Pressable onPress={() => setBioOpen((v) => !v)} accessibilityRole="button" accessibilityLabel={bioOpen ? 'Show less of the biography' : 'Show the whole biography'}>
          <Text numberOfLines={bioOpen ? undefined : 4} style={[type.bodySm, styles.bio]}>{person.biography}</Text>
        </Pressable>
      ) : null}
      tiles={tiles}
      extra={(
        <>
          {tagCategory || akas.length ? (
            <View style={styles.tagMeta}>
              {tagCategory ? <Text style={[type.caption, styles.categoryChip]}>{tagCategory}</Text> : null}
              {akas.length ? <Text style={[type.caption, { flexShrink: 1 }]}>Also known as: {akas.join(', ')}</Text> : null}
            </View>
          ) : null}
          {delta ? (
            <Text style={[type.bodySm, { marginTop: 12 }]}>
              Across the {delta.n} you&apos;ve rated, you score {name}{' '}
              {Math.abs(delta.d) < 0.05 ? 'the same as the crowd' : `${Math.abs(delta.d).toFixed(1)} ${delta.d > 0 ? 'higher' : 'lower'} than the crowd`}
            </Text>
          ) : null}
          {impacts.map((im) => {
            const pull = pullLine(kind, im, name);
            return (
              <View key={im.role ?? 'tag'} style={{ gap: 6 }}>
                {im.points !== null ? (
                  <View style={styles.impact}>
                    <Text style={[styles.impactPill, IMPACT_TONE[im.direction]]}>Taste {signed(im.points)}</Text>
                    <Text style={[type.bodySm, { flex: 1, minWidth: 0 }]}>{impactLine(kind, im)}</Text>
                  </View>
                ) : null}
                {pull && im.pull ? (
                  <View style={styles.impact}>
                    <Text style={[styles.impactPill, IMPACT_TONE[im.pull.points >= 0.5 ? 'up' : im.pull.points <= -0.5 ? 'down' : 'neutral']]}>Pull {signed(im.pull.points)}</Text>
                    <Text style={[type.bodySm, { flex: 1, minWidth: 0 }]}>{pull}</Text>
                  </View>
                ) : null}
              </View>
            );
          })}
          {/* No impact row has a reason, and the reason is said (AGENTS.md: a component that renders null must know why). */}
          {absence ? <Text style={[type.caption, { color: color.textSecondary, marginTop: 12 }]}>{absence}</Text> : null}
          {auth.status === 'signedIn' && followIds.length ? (
            // Follow: this counts as the most you could seek out, on every title that carries it. Not interested: the least. Neither touches how you rate it.
            <View style={styles.followRow}>
              {([['follow', 'Follow', 'Following'], ['avoid', 'Not interested', 'Avoiding']] as const).map(([mode, off, on]) => {
                const active = followMode === mode;
                return (
                  <Pressable
                    key={mode} disabled={followBusy} hitSlop={6} accessibilityRole="button" accessibilityState={{ selected: active }}
                    accessibilityLabel={active ? `${on} ${name}, undo` : `${off}: ${name}`}
                    onPress={() => {
                      setFollowBusy(true);
                      setFollow(db, followIds.map((id) => ({ facetId: id, label: name })), active ? null : mode)
                        .then(() => auth.rowsChanged())
                        .catch((e: unknown) => console.warn('follow_failed', e instanceof Error ? `${e.name}: ${e.message}` : String(e)))
                        .finally(() => setFollowBusy(false));
                    }}
                    style={({ pressed }) => [styles.followBtn, active && (mode === 'follow' ? styles.followOn : styles.avoidOn), (pressed || followBusy) && { opacity: 0.6 }]}>
                    <Text style={[type.caption, { color: active ? color.textOnAccent : color.textSecondary }]}>{active ? on : off}</Text>
                  </Pressable>
                );
              })}
              <Text style={[type.caption, { flexShrink: 1 }]}>
                {followMode === 'follow' ? 'Counts as the most you could seek out, on every title with it.' : followMode === 'avoid' ? 'Counts as the least, on every title with it.' : 'Tell the match you seek this out, or that you do not.'}
              </Text>
            </View>
          ) : null}
        </>
      )}
      count={`titles · ${sorted.length}${narrowed && sorted.length !== (cards ?? []).length ? ` of ${(cards ?? []).length}` : ''}${asking ? ' · asking for more…' : ''}`}
      sort={(
        <View style={styles.controls}>
          {typesHere.length > 1 ? <TypeRow offered={typesHere} kept={kept} onToggle={(t) => setKept((s) => { const n = new Set(s); if (n.has(t)) n.delete(t); else n.add(t); return n; })} /> : null}
          <FiltersButton active={countActive(filters)} onPress={() => setSheet(true)} />
          <SortMenu value={sort} options={center == null ? SORTS.filter(([k]) => k !== 'fandexScore') : SORTS} onChange={setSort} />
        </View>
      )}
    />
  );

  const grouped = split.series.length > 0;
  return (
    <Screen wide>
      <PosterGrid
        items={split.rest}
        header={grouped ? (
          <>
            {header}
            <View style={styles.series}>
              {split.series.map((s) => <CardRail key={s.id} title={s.label} items={s.items} />)}
              {split.rest.length ? <RailHeader title="Everything else" /> : null}
            </View>
          </>
        ) : header}
        empty={grouped ? undefined : asking ? <StateBlock loading />
          : narrowed ? <EmptyState title="Nothing matches these filters" hint="Widen the types or the filters above." />
          : <EmptyState title="Nothing here yet" hint={sync.state === 'syncing' ? 'The catalog is still downloading.' : 'No title in the catalog or at the providers carries this.'} />}
      />
      <FilterSheet
        open={sheet} onClose={() => setSheet(false)} filters={filters} onChange={setFilters}
        resultCount={sorted.length} noun="titles" signedIn={auth.status === 'signedIn'}
        items={typed} onEditPlatforms={() => { setSheet(false); router.push('/settings' as never); }}
      />
      {photoAt != null && person?.photos.length ? <PhotoGallery photos={person.photos} name={name} start={photoAt} onClose={() => setPhotoAt(null)} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  bio: { marginTop: 12, maxWidth: 720 },
  // The item page's gap between rails.
  series: { gap: 40, paddingTop: 8, paddingBottom: 16 },
  photoCount: {
    position: 'absolute', right: -2, bottom: -2, minWidth: 22, height: 22, paddingHorizontal: 5, borderRadius: radius.full,
    alignItems: 'center', justifyContent: 'center', backgroundColor: color.surfaceOverlay, borderWidth: 1, borderColor: color.borderStrong,
  },
  photoCountText: { fontFamily: font.mono, fontSize: 10, color: color.textPrimary },
  impact: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  tagMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 12 },
  categoryChip: {
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.full, overflow: 'hidden',
    backgroundColor: `${color.facet.tag}21`, color: color.textPrimary,
  },
  followRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 12 },
  followBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: color.border },
  followOn: { backgroundColor: color.accent, borderColor: color.accent },
  avoidOn: { backgroundColor: color.scoreLow, borderColor: color.scoreLow },
  impactPill: {
    fontFamily: font.sansBold, fontSize: 14, lineHeight: 20, fontVariant: ['tabular-nums'],
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full, overflow: 'hidden',
  },
  controls: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10, flexShrink: 1 },
  typeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  typeChip: { width: 30, height: 30, borderRadius: radius.full, borderWidth: 1, borderColor: color.borderStrong, alignItems: 'center', justifyContent: 'center' },
});
