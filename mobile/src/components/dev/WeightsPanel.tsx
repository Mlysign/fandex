// Scoring admin, "Weights & Tuning". A port of the site's
// src/app/dev/scoring/WeightsPanel.tsx.
//
// One thing works differently and better for it: the preview. The site posted
// the draft to its server, which scored one of your titles with it. The app's
// score is computed on the device, so the preview is too: the same engine every
// screen uses, run with the draft in place of what is stored. Nothing is sent.
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import type { ScoringConfigValues } from '@/lib/scoringDefaults';
import { Button } from '~/components/kit';
import { api, ApiError } from '~/lib/api';
import {
  buildProfile, computeFandexScore, MIN_RATED_FOR_FANDEX_SCORE,
  type ScoreReason, type Taxonomy, type TaxonomyJson,
} from '~/lib/fandexScore';
import { parseFacets, ratedTitles } from '~/lib/ScoreProvider';
import { breakpoint, color, font, radius } from '~/theme';

export const ROLE_ORDER = ['director', 'creator', 'writer', 'cast', 'developer', 'publisher', 'studio', 'network', 'ip'];
const ROLE_LABELS: Record<string, string> = {
  director: 'Directors', writer: 'Writers', creator: 'Creators', cast: 'Cast', developer: 'Developers',
  publisher: 'Publishers', studio: 'Studios', network: 'Networks', ip: 'Franchise',
};
const MAX_PINNED = 3;

export type Category = TaxonomyJson['tagCategories'][number];
interface Pinned { id: string; title: string; type: string }
interface Preview { itemId: string; itemTitle: string; score: number | null; reasons: ScoreReason[]; coldStart: boolean }

/** A number field that lets you type "0." on the way to "0.5" without snapping back. */
export function NumField({ value, onChange, disabled, label }: { value: number; onChange: (n: number) => void; disabled?: boolean; label: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { if (Number(text) !== value) setText(String(value)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [value]);
  return (
    <TextInput
      value={text} editable={!disabled} keyboardType="decimal-pad" accessibilityLabel={label}
      onChangeText={(t) => { const clean = t.replace(',', '.').replace(/[^0-9.]/g, ''); setText(clean); const n = Number(clean); if (clean !== '' && Number.isFinite(n)) onChange(n); }}
      style={[styles.num, disabled && { opacity: 0.4 }]}
    />
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.block}>
      <Text style={styles.blockTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={[styles.text, { flex: 1 }]}>{label}</Text>
      {children}
    </View>
  );
}

export function WeightsPanel({ config, categories, taxonomy, onSaved }: {
  config: ScoringConfigValues;
  categories: Category[];
  /** The stored taxonomy, which the preview scores with after swapping the draft in. */
  taxonomy: Taxonomy;
  onSaved: () => Promise<void>;
}) {
  const db = useSQLiteContext();
  const { width } = useWindowDimensions();
  const [draft, setDraft] = useState<ScoringConfigValues>(config);
  const [cats, setCats] = useState<Category[]>(categories);
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState<{ ok: boolean; msg: string } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [pinned, setPinned] = useState<Pinned[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Pinned[]>([]);

  const set = (patch: Partial<ScoringConfigValues>) => setDraft((c) => ({ ...c, ...patch }));
  const setCat = (id: string, patch: Partial<Category>) => setCats((list) => list.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  // Your library, by title. The site asked its server; the rows are here.
  const search = async () => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); return; }
    setResults(await db.getAllAsync<Pinned>(
      `SELECT DISTINCT c.id, c.title, c.type FROM item_state s JOIN catalog c ON c.id = s.media_item_id
        WHERE s.relation = 'library' AND c.title LIKE ? ORDER BY c.title LIMIT 20`, [`%${q}%`],
    ));
  };

  const preview = async () => {
    setPreviewing(true);
    setPreviewError(null);
    try {
      const rated = await ratedTitles(db);
      const tax: Taxonomy = {
        ...taxonomy, config: draft,
        categories: new Map(cats.map((c) => [c.id, { label: c.label, weight: c.weight, ignored: !!c.ignored }])),
      };
      const profile = buildProfile(rated, tax);
      let targets = pinned.map((p) => ({ id: p.id, title: p.title }));
      if (!targets.length) {
        // The site's default: your top-rated title, the latest one when several tie.
        const top = await db.getFirstAsync<{ id: string; title: string }>(
          `SELECT c.id, c.title FROM item_state s JOIN catalog c ON c.id = s.media_item_id
            WHERE s.relation = 'library' AND s.rating > 0 ORDER BY s.rating DESC, s.reviewed_at DESC LIMIT 1`,
        );
        if (!top) throw new Error('No rated library item to preview against yet. Rate something first.');
        targets = [top];
      }
      const out: Preview[] = [];
      for (const t of targets) {
        const row = await db.getFirstAsync<{ facets: string }>('SELECT facets FROM catalog WHERE id = ?', [t.id]);
        const fx = row ? computeFandexScore(parseFacets(row.facets), t.id, profile, tax) : null;
        out.push({
          itemId: t.id, itemTitle: t.title, score: fx?.score ?? null,
          reasons: (fx?.reasons ?? []).filter((r) => !r.capped),
          coldStart: profile.ratedItemCount < MIN_RATED_FOR_FANDEX_SCORE,
        });
      }
      setPreviews(out);
    } catch (e) {
      setPreviews([]);
      setPreviewError(e instanceof Error ? e.message : 'Preview failed');
    } finally {
      setPreviewing(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setSaveNote(null);
    try {
      await api.adminSaveScoring(draft);
      await api.adminSaveCategoryWeights(cats.map((c) => ({ id: c.id, weight: c.weight, ignored: !!c.ignored })));
      await onSaved();
      setSaveNote({ ok: true, msg: 'Saved. Every device picks this up the next time it checks.' });
    } catch (e) {
      setSaveNote({ ok: false, msg: e instanceof ApiError && e.message ? `Not saved: ${e.message}` : 'Not saved. Nothing was changed.' });
    } finally {
      setSaving(false);
    }
  };

  const wide = width >= breakpoint.md;
  return (
    <View style={[styles.columns, wide && { flexDirection: 'row', alignItems: 'flex-start' }]}>
      <View style={[styles.column, wide && { flex: 1 }]}>
        <Block title="Role weights">
          <View style={styles.grid2}>
            {ROLE_ORDER.map((role) => (
              <View key={role} style={styles.cell2}>
                <Field label={ROLE_LABELS[role] ?? role}>
                  <NumField label={ROLE_LABELS[role] ?? role} value={draft.roleWeights[role] ?? 1} onChange={(n) => set({ roleWeights: { ...draft.roleWeights, [role]: n } })} />
                </Field>
              </View>
            ))}
          </View>
        </Block>

        <Block title="Category weights">
          <View style={{ gap: 6 }}>
            {cats.map((c) => (
              <View key={c.id} style={styles.catRow}>
                <View style={[styles.dot, { backgroundColor: c.color }]} />
                <Text numberOfLines={1} style={[styles.text, { flex: 1, color: color.neutral400 }]}>{c.label}</Text>
                <NumField label={`${c.label} weight`} value={c.weight} disabled={!!c.ignored} onChange={(n) => setCat(c.id, { weight: n })} />
                <Pressable onPress={() => setCat(c.id, { ignored: !c.ignored })} accessibilityRole="checkbox" accessibilityState={{ checked: !!c.ignored }} style={styles.check}>
                  <View style={[styles.box, !!c.ignored && styles.boxOn]} />
                  <Text style={styles.tiny}>Ignored</Text>
                </Pressable>
              </View>
            ))}
          </View>
        </Block>

        <Block title="Calibration">
          <View style={{ gap: 16 }}>
            <View style={{ gap: 4 }}>
              <Field label="Prior strength (C)"><NumField label="Prior strength" value={draft.priorStrength} onChange={(n) => set({ priorStrength: n })} /></Field>
              <Text style={styles.tiny}>
                How skeptical the model is of small samples. Each facet's rating average is pulled toward your overall baseline until it
                has ~C rated items of evidence. Higher C = a one-off rating barely moves the needle; lower C = a single item swings that
                facet's score faster.
              </Text>
            </View>
            <View style={{ gap: 4 }}>
              <Field label="Mapping constant, above your average (K_up)"><NumField label="K up" value={draft.mappingConstantUp} onChange={(n) => set({ mappingConstantUp: n })} /></Field>
              <Text style={styles.tiny}>
                Formula: yourAvgRating×10 + K · Σ(dev·weight). A raw sum over the selected facets below, not an average, and no longer
                clamped to 0–100. Applied when an item's facets sum positive. Higher K_up = a good match swings up more dramatically.
              </Text>
            </View>
            <View style={{ gap: 4 }}>
              <Field label="Mapping constant, below your average (K_down)"><NumField label="K down" value={draft.mappingConstantDown} onChange={(n) => set({ mappingConstantDown: n })} /></Field>
              <Text style={styles.tiny}>
                Same formula, applied when an item scores below your average. Set lower than K_up to skew the visible range toward
                enthusiasm, so mismatches drop off gently instead of the score reading as “you won't like this.” The center itself (your
                own average rating, ×10) is not a knob. Only these two gains are.
              </Text>
            </View>
          </View>
        </Block>

        <Block title="Selection (top-N)">
          <Text style={styles.tiny}>
            The score is a raw sum, not an average, so it needs a fixed number of facets to sum, or a tag-dense item (a 300-tag game)
            would swamp a sparse one (a 5-tag film). Each item's highest-contributing facets, up to these counts per bucket, are
            summed; everything else is shown greyed-out as “not counted for this title.”
          </Text>
          <View style={styles.grid2}>
            {([
              ['Top tags (positive)', 'topTagsPositive'], ['Top tags (negative)', 'topTagsNegative'], ['Top people', 'topPeople'],
              ['Top companies', 'topCompanies'], ['Top franchises', 'topIps'],
            ] as [string, keyof ScoringConfigValues][]).map(([label, key]) => (
              <View key={key} style={styles.cell2}>
                <Field label={label}><NumField label={label} value={draft[key] as number} onChange={(n) => set({ [key]: Math.max(0, Math.round(n)) })} /></Field>
              </View>
            ))}
          </View>
        </Block>

        <View style={styles.buttons}>
          <Button label={previewing ? 'Previewing…' : 'Preview'} size="md" onPress={() => void preview()} disabled={previewing} />
          <Button label={saving ? 'Saving…' : 'Save weights'} size="md" variant="primary" onPress={() => void save()} disabled={saving} />
        </View>
        {saveNote ? <Text style={[styles.text, { color: saveNote.ok ? color.success : color.danger }]}>{saveNote.msg}</Text> : null}
      </View>

      <View style={[styles.block, wide && { flex: 1 }]}>
        <Text style={styles.blockTitle}>Preview</Text>
        <View style={styles.searchRow}>
          <TextInput
            value={query} onChangeText={setQuery} onSubmitEditing={() => void search()} editable={pinned.length < MAX_PINNED}
            placeholder="Search your library to pin an item…" placeholderTextColor={color.textSecondary} returnKeyType="search"
            style={[styles.search, pinned.length >= MAX_PINNED && { opacity: 0.5 }]}
          />
          <Button label="Search" onPress={() => void search()} disabled={pinned.length >= MAX_PINNED} />
        </View>
        {pinned.length >= MAX_PINNED ? <Text style={styles.tiny}>Max {MAX_PINNED} items pinned. Remove one to add another.</Text> : null}
        {results.length ? (
          <View style={styles.results}>
            {results.map((r) => (
              <Pressable
                key={r.id} accessibilityRole="button" style={styles.result}
                onPress={() => { setPinned((cur) => (cur.some((p) => p.id === r.id) || cur.length >= MAX_PINNED ? cur : [...cur, r])); setQuery(''); setResults([]); }}
              >
                <Text numberOfLines={1} style={styles.text}>{r.title} <Text style={styles.tiny}>· {r.type}</Text></Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {pinned.length ? (
          <View style={styles.pins}>
            {pinned.map((p) => (
              <Pressable key={p.id} onPress={() => setPinned((cur) => cur.filter((x) => x.id !== p.id))} accessibilityRole="button" accessibilityLabel={`Unpin ${p.title}`} style={styles.pin}>
                <Text numberOfLines={1} style={[styles.tiny, { color: color.textPrimary, maxWidth: 160 }]}>{p.title}</Text>
                <Text style={styles.tiny}>×</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {previews.length === 0 && !previewError ? (
          <Text style={styles.text}>
            {pinned.length > 0
              ? 'Hit Preview to score your pinned items against these draft weights. Nothing is saved.'
              : 'Scores your own top-rated library item against these draft weights. Nothing is saved. Pin up to 3 specific items above to compare instead.'}
          </Text>
        ) : null}
        {previewError ? <Text style={[styles.text, { color: color.danger }]}>{previewError}</Text> : null}
        {previews.map((p, i) => (
          <View key={p.itemId} style={[{ gap: 8 }, i > 0 && styles.previewNext]}>
            <Text numberOfLines={1} style={styles.text}>{p.itemTitle}</Text>
            {p.coldStart ? <Text style={styles.text}>Cold-start: not enough rated items to score.</Text>
              : p.score == null ? <Text style={styles.text}>No facet on this item matches your profile.</Text> : (
                <>
                  <Text style={styles.score}>{Math.round(p.score)}</Text>
                  <View style={{ gap: 4 }}>
                    {p.reasons.map((r) => (
                      <View key={`${r.kind}|${r.role ?? ''}|${r.label}`} style={styles.reason}>
                        <Text numberOfLines={1} style={[styles.tiny, { flex: 1 }]}>{r.label}</Text>
                        <Text style={[styles.tiny, { color: r.contribution >= 0 ? color.success : color.danger }]}>
                          {r.contribution >= 0 ? '+' : ''}{r.contribution.toFixed(1)}
                        </Text>
                      </View>
                    ))}
                  </View>
                </>
              )}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  columns: { gap: 24 },
  column: { gap: 24 },
  block: { padding: 16, gap: 12, borderRadius: radius.lg, borderWidth: 1, borderColor: color.border, backgroundColor: color.surfaceElevated },
  blockTitle: { fontFamily: font.sansBold, fontSize: 14, lineHeight: 20, color: color.textPrimary },
  text: { fontFamily: font.sans, fontSize: 14, lineHeight: 20, color: color.textSecondary },
  tiny: { fontFamily: font.sans, fontSize: 12, lineHeight: 16, color: color.textSecondary },
  grid2: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 8 },
  cell2: { flexGrow: 1, flexBasis: 220 },
  field: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  num: {
    width: 96, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm, borderWidth: 1, borderColor: color.borderStrong,
    backgroundColor: color.surfaceInset, color: color.textPrimary, fontFamily: font.sans, fontSize: 14,
  },
  catRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dot: { width: 10, height: 10, borderRadius: radius.full },
  check: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32 },
  box: { width: 14, height: 14, borderRadius: 3, borderWidth: 1, borderColor: color.borderStrong },
  boxOn: { backgroundColor: color.accent, borderColor: color.accent },
  buttons: { flexDirection: 'row', gap: 12 },
  searchRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  search: {
    flex: 1, minWidth: 0, paddingHorizontal: 8, paddingVertical: 6, borderRadius: radius.sm, borderWidth: 1, borderColor: color.borderStrong,
    backgroundColor: color.surfaceInset, color: color.textPrimary, fontFamily: font.sans, fontSize: 14,
  },
  results: { borderRadius: radius.sm, borderWidth: 1, borderColor: color.borderStrong, backgroundColor: color.surfaceInset, maxHeight: 192, overflow: 'hidden' },
  result: { paddingHorizontal: 10, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: color.border },
  pins: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pin: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 8, paddingRight: 6, paddingVertical: 4, borderRadius: radius.sm, backgroundColor: color.neutral800 },
  previewNext: { paddingTop: 16, borderTopWidth: 1, borderTopColor: color.border },
  score: { fontFamily: font.sansBold, fontSize: 24, lineHeight: 32, color: color.textPrimary },
  reason: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
});
