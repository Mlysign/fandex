// Scoring admin, Taxonomy → Review. A port of the site's
// src/app/dev/scoring/ReviewPanel.tsx.
//
// Three verbs on every card: accept, deny, and the correction its own shape
// needs (another category for a tag batch, the other direction for a merge,
// another franchise for a membership). Accept and deny alone force a
// wrong-but-close proposal to be thrown away and redone by hand elsewhere,
// which is how a review queue stops being used.
//
// The sweep runs on the device (lib/taxonomySweep.ts) over the catalog copy;
// the site asked its server. So a card goes the moment a write answers: the
// taxonomy that comes back is swept again right here, with no second request.
//
// ⚠️ Accepting has no route of its own. It is the Tags table's category write,
// the Franchises list's bundle and its attach, so a card cannot reach a write
// the hand-made panels do not already make. The one route this screen owns is
// the one that remembers a no.
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { tagCategoryHex } from '@/lib/facetPalette';
import { Button } from '~/components/kit';
import { api, ApiError } from '~/lib/api';
import { useCatalogSync } from '~/lib/CatalogSyncProvider';
import type { TaxonomyJson } from '~/lib/fandexScore';
import { catalogTitles, type CatalogTitle } from '~/lib/ipSurvey';
import { buildTagRows, rawTagCounts } from '~/lib/tagVocab';
import {
  runTaxonomySweep, type FranchiseMemberSuggestion, type FranchiseMergeSuggestion, type SweepReport, type TagCategorySuggestion,
} from '~/lib/taxonomySweep';
import { color, font, radius } from '~/theme';
import { num } from './parts';
import { Select } from './Select';
import type { Category } from './WeightsPanel';

type Write = (run: () => Promise<TaxonomyJson>) => Promise<boolean>;
type Lens = 'all' | 'tag-category' | 'franchise-merge' | 'franchise-member';

const LENSES: [Lens, string][] = [
  ['all', 'Everything'], ['tag-category', 'Tag categories'], ['franchise-merge', 'Franchise merges'], ['franchise-member', 'Missing members'],
];
const MEMBER_PAGE = 40;
const TAGS_SHOWN = 14;

const reason = (e: unknown) => (e instanceof ApiError && e.message ? e.message : e instanceof Error ? e.message : 'That did not save.');

function Stats({ stats }: { stats: SweepReport['stats'] }) {
  const pct = stats.totalTags ? Math.round((100 * stats.otherTags) / stats.totalTags) : 0;
  const after = stats.totalTags ? Math.round((100 * stats.otherAfterAccepting) / stats.totalTags) : 0;
  const strong = { color: color.textPrimary, fontFamily: font.sansBold };
  return (
    <View style={styles.stats}>
      <Text style={styles.tiny}>
        <Text style={strong}>{num(stats.otherTags)}</Text> of {num(stats.totalTags)} tags sit in Other ({pct}%). Accepting every tag card
        below takes that to <Text style={strong}>{num(stats.otherAfterAccepting)}</Text> ({after}%), moving {num(stats.tagsCovered)} tags
        across {num(stats.itemsAffected)} catalog appearances.
      </Text>
      <Text style={styles.tiny}>
        {num(stats.franchises)} franchises, {num(stats.singletonFranchises)} of them holding a single title.
        {stats.dismissed > 0 ? ` ${stats.dismissed} suggestion${stats.dismissed === 1 ? '' : 's'} denied and hidden.` : ''}
      </Text>
      <Text style={[styles.tiny, { color: color.textMuted }]}>
        The tail is the long part: nearly every tag left in Other after this appears three times or fewer in the whole catalog. Those are
        best handled with the Tags table&apos;s bulk select, not one card at a time.
      </Text>
    </View>
  );
}

// ── A batch of tags for one category ─────────────────────────────────────────

function TagCard({ card, categories, busy, onAccept, onDeny }: {
  card: TagCategorySuggestion; categories: Category[]; busy: boolean;
  onAccept: (card: TagCategorySuggestion, tagKeys: string[], categoryId: string) => void; onDeny: () => void;
}) {
  const [target, setTarget] = useState(card.categoryId);
  const [expanded, setExpanded] = useState(false);
  // What is left out, not what is kept: the set starts as everything, and
  // picking out the handful that do not belong is the job.
  const [dropped, setDropped] = useState<Set<string>>(new Set());

  const keys = card.tags.filter((t) => !dropped.has(t.key)).map((t) => t.key);
  const targetLabel = categories.find((c) => c.id === target)?.label ?? (target === card.categoryId ? card.categoryLabel : target);
  // A proposed category has no row yet, so it cannot come from the live list.
  // Offering it is what makes "accept, but into something else" possible here.
  const proposed = card.createsCategory && !categories.some((c) => c.id === card.createsCategory!.id) ? card.createsCategory : null;
  const options: [string, string][] = [
    ...(proposed ? [[proposed.id, `${proposed.label} (new)`] as [string, string]] : []),
    ...categories.map((c): [string, string] => [c.id, c.label]),
  ];
  const toggle = (key: string) => setDropped((d) => { const n = new Set(d); if (!n.delete(key)) n.add(key); return n; });

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={{ flexShrink: 1, minWidth: 0, flexBasis: 280, flexGrow: 1 }}>
          <Text style={[styles.text, { color: color.textPrimary }]}>{card.title}</Text>
          <Text style={[styles.tiny, { marginTop: 2 }]}>{card.why}</Text>
        </View>
        <View style={{ marginLeft: 'auto', alignItems: 'flex-end' }}>
          <Text style={[styles.tiny, { color: color.neutral400 }]}>→ {targetLabel}</Text>
          <Text style={styles.tiny}>{card.tags.length} tags · {num(card.itemsAffected)} appearances</Text>
          {proposed ? <Text style={[styles.tiny, { color: color.warning }]}>creates this category</Text> : null}
        </View>
      </View>

      {/* A chip can always be pressed. "Show more" decides how many are shown and nothing else. */}
      <View style={styles.chips}>
        {(expanded ? card.tags : card.tags.slice(0, TAGS_SHOWN)).map((t) => {
          const out = dropped.has(t.key);
          return (
            <Pressable
              key={t.key} onPress={() => toggle(t.key)} accessibilityRole="button"
              accessibilityLabel={out ? `Put ${t.label} back` : `Leave ${t.label} out of this batch`}
              style={[styles.chip, out && { backgroundColor: color.surface }]}
            >
              <Text style={[styles.tiny, { color: out ? color.textMuted : color.textPrimary }, out && { textDecorationLine: 'line-through' }]}>
                {t.label} <Text style={{ color: color.textMuted }}>{t.count}×</Text>
              </Text>
            </Pressable>
          );
        })}
        {!expanded && card.tags.length > TAGS_SHOWN ? (
          <Pressable onPress={() => setExpanded(true)} hitSlop={8} accessibilityRole="button">
            <Text style={styles.link}>+{card.tags.length - TAGS_SHOWN} more</Text>
          </Pressable>
        ) : null}
        <Text style={[styles.tiny, { fontSize: 11, color: color.textMuted, paddingLeft: 4 }]}>press one to leave it out</Text>
      </View>

      <View style={styles.actions}>
        <Button label={busy ? 'Applying…' : `Accept ${keys.length}`} disabled={busy || keys.length === 0} onPress={() => onAccept(card, keys, target)} />
        <Text style={styles.tiny}>into</Text>
        <Select label="Move these tags into" value={target} options={options} onChange={setTarget} disabled={busy} width={180} />
        {dropped.size > 0 ? <Text style={[styles.tiny, { color: color.textMuted }]}>{dropped.size} left out</Text> : null}
        <Button label="Deny" variant="ghost" disabled={busy} onPress={onDeny} style={{ marginLeft: 'auto' }} />
      </View>
    </View>
  );
}

// ── Two franchises that are probably one ─────────────────────────────────────

function MergeCard({ card, busy, onBundle, onDeny }: {
  card: FranchiseMergeSuggestion; busy: boolean; onBundle: (ref: string, aliasKey: string, canonicalKey: string) => void; onDeny: () => void;
}) {
  const muted = { color: color.textMuted };
  return (
    <View style={styles.card}>
      <Text style={[styles.text, { color: color.textPrimary }]}>
        {card.aliasLabel} <Text style={muted}>({card.aliasSize})</Text><Text style={{ color: color.textSecondary }}> → </Text>
        {card.canonicalLabel} <Text style={muted}>({card.canonicalSize})</Text>
      </Text>
      <Text style={styles.tiny}>{card.why}</Text>

      {/* Titles from both sides: "Portal" against "Portal Knights" is two unrelated games, and the names alone do not say so. */}
      <View style={styles.sides}>
        <View style={styles.side}>
          <Text style={styles.tiny}>{card.aliasLabel}</Text>
          <Text style={[styles.tiny, muted]}>{card.aliasSample.join(' · ') || '-'}</Text>
        </View>
        <View style={styles.side}>
          <Text style={styles.tiny}>{card.canonicalLabel}</Text>
          <Text style={[styles.tiny, muted]}>{card.canonicalSample.join(' · ') || '-'}</Text>
        </View>
      </View>

      <View style={styles.actions}>
        <Button label={busy ? 'Bundling…' : `Bundle into ${card.canonicalLabel}`} disabled={busy} onPress={() => onBundle(card.ref, card.aliasKey, card.canonicalKey)} />
        {/* The correction this card needs: which of the two is the franchise. */}
        <Button label={`Other way: into ${card.aliasLabel}`} variant="ghost" disabled={busy} onPress={() => onBundle(card.ref, card.canonicalKey, card.aliasKey)} />
        <Button label="Deny" variant="ghost" disabled={busy} onPress={onDeny} style={{ marginLeft: 'auto' }} />
      </View>
    </View>
  );
}

// ── A title that belongs to a franchise and is in none ───────────────────────

function MemberCard({ card, busy, franchiseLabels, onAttach, onDeny }: {
  card: FranchiseMemberSuggestion; busy: boolean; franchiseLabels: string[];
  onAttach: (ref: string, mediaItemId: string, label: string) => void; onDeny: () => void;
}) {
  const [label, setLabel] = useState(card.ipLabel);
  const [typing, setTyping] = useState(false);
  // Free text, with the known names offered while typing. An attach takes a
  // NAME: one the catalog knows joins that franchise, a new one makes it. So
  // this one field is both the correction and the "none of these" way out.
  const term = label.trim().toLowerCase();
  const matches = typing && term.length >= 2 ? franchiseLabels.filter((l) => l.toLowerCase().includes(term) && l !== label).slice(0, 6) : [];

  return (
    <View style={[styles.card, { paddingVertical: 8, gap: 6 }]}>
      <View style={[styles.actions, { rowGap: 4 }]}>
        <Text numberOfLines={1} style={[styles.text, { color: color.textPrimary, maxWidth: 224, flexShrink: 1 }]}>{card.itemTitle}</Text>
        <Text style={styles.kind}>{card.itemType}</Text>
        <Text style={[styles.text, { color: color.textMuted }]}>→</Text>
        <TextInput
          value={label} onChangeText={(v) => { setLabel(v); setTyping(true); }} onBlur={() => setTyping(false)} editable={!busy}
          accessibilityLabel={`Franchise for ${card.itemTitle}`} style={[styles.input, { width: 192 }]}
        />
        <Text style={[styles.tiny, { color: color.textMuted }]}>{card.franchiseSize} titles</Text>
        <View style={[styles.actions, { marginLeft: 'auto', flexWrap: 'nowrap' }]}>
          <Button label={busy ? 'Adding…' : 'Add'} disabled={busy || !label.trim()} onPress={() => onAttach(card.ref, card.mediaItemId, label.trim())} />
          <Button label="Deny" variant="ghost" disabled={busy} onPress={onDeny} />
        </View>
      </View>
      {matches.length > 0 ? (
        <View style={styles.chips}>
          {matches.map((l) => (
            // onPressIn, so the press lands before the field's blur takes the list away.
            <Pressable key={l} onPressIn={() => { setLabel(l); setTyping(false); }} accessibilityRole="button" style={styles.chip}>
              <Text numberOfLines={1} style={[styles.tiny, { color: color.textPrimary, maxWidth: 200 }]}>{l}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ── The section ──────────────────────────────────────────────────────────────

export function ReviewPanel({ json, write }: { json: TaxonomyJson; write: Write }) {
  const db = useSQLiteContext();
  const catalog = useCatalogSync();
  const [raw, setRaw] = useState<Awaited<ReturnType<typeof rawTagCounts>> | null>(null);
  const [titles, setTitles] = useState<CatalogTitle[] | null>(null);
  const [dismissed, setDismissed] = useState<[string, string][] | null>(null);
  const [run, setRun] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [lens, setLens] = useState<Lens>('all');
  const [memberLimit, setMemberLimit] = useState(MEMBER_PAGE);
  const [error, setError] = useState<string | null>(null);

  // Two passes over the catalog copy, the same two the Tags table and the Franchises list make.
  useEffect(() => {
    let live = true;
    setRaw(null);
    setTitles(null);
    void Promise.all([rawTagCounts(db), catalogTitles(db)]).then(([r, t]) => { if (live) { setRaw(r); setTitles(t); } });
    return () => { live = false; };
  }, [db, catalog.revision, run]);

  // ⚠️ No sweep before the list of denials has arrived. A sweep without it
  // shows every proposal somebody already said no to, as if it were new.
  const loadDismissed = useCallback(async () => {
    setError(null);
    try {
      setDismissed((await api.adminDismissed()).dismissed);
    } catch (e) {
      setError(`The denied suggestions could not be read, so nothing is shown. ${reason(e)}`);
    }
  }, []);
  useEffect(() => { void loadDismissed(); }, [loadDismissed, run]);

  const report = useMemo(
    () => (raw && titles && dismissed ? runTaxonomySweep({ tags: buildTagRows(raw, json), titles, tax: json, dismissed }) : null),
    [raw, titles, dismissed, json],
  );

  const act = async (ref: string, steps: (() => Promise<TaxonomyJson>)[]) => {
    setBusy(ref);
    setError(null);
    // In order, and stop at the first that fails.
    for (const step of steps) if (!(await write(step))) break;
    setBusy(null);
  };

  const acceptTags = (card: TagCategorySuggestion, tagKeys: string[], categoryId: string) => {
    if (!tagKeys.length) return;
    const steps: (() => Promise<TaxonomyJson>)[] = [];
    // A rule may point at a category that does not exist yet. Make it first,
    // and stop if that fails: tags moved into a missing category would still
    // list under Other, which looks exactly like the accept having done nothing.
    const make = card.createsCategory;
    if (make && categoryId === make.id && !json.tagCategories.some((c) => c.id === make.id)) {
      steps.push(() => api.adminSaveCategory({ id: make.id, label: make.label, color: tagCategoryHex(make.id), weight: 1, ignored: false }));
    }
    steps.push(() => api.adminTagOverrides(tagKeys, categoryId));
    void act(card.ref, steps);
  };
  const bundle = (ref: string, aliasKey: string, canonicalKey: string) => void act(ref, [() => api.adminAddAliases('ip', canonicalKey, [aliasKey])]);
  const attach = (ref: string, mediaItemId: string, label: string) => void act(ref, [() => api.adminIpOverride({ mediaItemId, mode: 'add', label })]);

  const deny = async (kind: string, ref: string) => {
    setBusy(ref);
    setError(null);
    try {
      setDismissed((await api.adminDismiss(kind, ref)).dismissed);
    } catch (e) {
      setError(reason(e));
    } finally {
      setBusy(null);
    }
  };

  const all = report?.suggestions ?? [];
  const shown = lens === 'all' ? all : all.filter((s) => s.kind === lens);
  const members = shown.filter((s): s is FranchiseMemberSuggestion => s.kind === 'franchise-member');
  const franchiseLabels = useMemo(() => [...new Set((report?.suggestions ?? []).flatMap((s) =>
    s.kind === 'franchise-merge' ? [s.canonicalLabel, s.aliasLabel] : s.kind === 'franchise-member' ? [s.ipLabel] : []))].sort(), [report]);
  const sweeping = !report && !error;

  return (
    <View style={styles.block}>
      <View style={styles.cardHead}>
        <View style={{ flexShrink: 1, minWidth: 0, flexBasis: 280, flexGrow: 1 }}>
          <Text style={styles.blockTitle}>Review</Text>
          <Text style={[styles.tiny, { marginTop: 2, maxWidth: 576 }]}>
            What the catalog says is wrong with its own vocabulary. Nothing here is applied until you say so, and a denial is remembered,
            so the same card never comes back.
          </Text>
        </View>
        <Button label={sweeping ? 'Sweeping…' : 'Re-run sweep'} variant="ghost" disabled={sweeping} onPress={() => setRun((n) => n + 1)} />
      </View>

      {report ? <Stats stats={report.stats} /> : null}

      <View style={styles.chips}>
        {LENSES.map(([id, label]) => {
          const n = id === 'all' ? all.length : all.filter((s) => s.kind === id).length;
          return (
            <Pressable
              key={id} onPress={() => { setLens(id); setMemberLimit(MEMBER_PAGE); }} accessibilityRole="button" accessibilityState={{ selected: lens === id }}
              style={[styles.lens, lens === id && { backgroundColor: color.neutral800 }]}
            >
              <Text style={[styles.tiny, lens === id && { color: color.textPrimary }]}>{label} <Text style={{ color: color.textMuted }}>{n}</Text></Text>
            </Pressable>
          );
        })}
      </View>

      {error ? <Text style={[styles.tiny, { color: color.danger }]}>{error}</Text> : null}
      {sweeping ? <Text style={[styles.text, { color: color.textMuted }]}>Running the sweep…</Text> : null}
      {report && shown.length === 0 ? <Text style={[styles.text, { color: color.textMuted, paddingVertical: 16 }]}>Nothing left to review here.</Text> : null}

      <View style={{ gap: 10 }}>
        {shown.map((s) => (s.kind === 'tag-category' ? (
          <TagCard key={s.ref} card={s} categories={json.tagCategories} busy={busy === s.ref} onAccept={acceptTags} onDeny={() => void deny(s.kind, s.ref)} />
        ) : s.kind === 'franchise-merge' ? (
          <MergeCard key={s.ref} card={s} busy={busy === s.ref} onBundle={bundle} onDeny={() => void deny(s.kind, s.ref)} />
        ) : null))}
        {members.slice(0, memberLimit).map((s) => (
          <MemberCard key={s.ref} card={s} busy={busy === s.ref} franchiseLabels={franchiseLabels} onAttach={attach} onDeny={() => void deny(s.kind, s.ref)} />
        ))}
        {members.length > memberLimit ? (
          <Button label={`Show ${Math.min(MEMBER_PAGE, members.length - memberLimit)} more…`} variant="ghost" onPress={() => setMemberLimit((n) => n + MEMBER_PAGE)} style={{ alignSelf: 'flex-start' }} />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { padding: 16, gap: 16, borderRadius: radius.lg, borderWidth: 1, borderColor: color.border, backgroundColor: color.surfaceElevated },
  blockTitle: { fontFamily: font.sansBold, fontSize: 14, lineHeight: 20, color: color.textPrimary },
  text: { fontFamily: font.sans, fontSize: 14, lineHeight: 20, color: color.textSecondary },
  tiny: { fontFamily: font.sans, fontSize: 12, lineHeight: 16, color: color.textSecondary },
  link: { fontFamily: font.sans, fontSize: 12, lineHeight: 16, color: color.textSecondary, textDecorationLine: 'underline', textDecorationStyle: 'dotted' },
  kind: { fontFamily: font.sans, fontSize: 10, lineHeight: 14, color: color.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  stats: { paddingHorizontal: 12, paddingVertical: 10, gap: 4, borderRadius: radius.md, borderWidth: 1, borderColor: color.border, backgroundColor: color.surfaceInset },
  lens: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.sm },
  card: { padding: 12, gap: 8, borderRadius: radius.md, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface },
  cardHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 },
  chip: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: color.neutral800 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  sides: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  side: { flexGrow: 1, flexBasis: 240, minWidth: 0, gap: 2 },
  input: {
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.sm, borderWidth: 1, borderColor: color.borderStrong,
    backgroundColor: color.surfaceInset, color: color.textPrimary, fontFamily: font.sans, fontSize: 12,
  },
});
