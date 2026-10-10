// Scoring admin, Taxonomy → Franchises. A port of the site's
// src/app/dev/scoring/FranchisePanel.tsx.
//
// The list is surveyed on the device (lib/ipSurvey.ts) from the catalog copy;
// the site asked its server. Each action is a write to the Worker that answers
// with the taxonomy as stored, and the list is surveyed again from that.
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, SortMenu } from '~/components/kit';
import { api } from '~/lib/api';
import { useCatalogSync } from '~/lib/CatalogSyncProvider';
import type { TaxonomyJson } from '~/lib/fandexScore';
import { catalogTitles, suggestFranchisesByTitle, surveyFranchises, type CatalogTitle, type FranchiseMember, type FranchiseRow, type FranchiseSuggestion } from '~/lib/ipSurvey';
import { color, font, radius } from '~/theme';

type Write = (run: () => Promise<TaxonomyJson>) => Promise<boolean>;
type Act = (busyKey: string, run: () => Promise<TaxonomyJson>) => Promise<boolean>;
interface Hit { id: string; title: string; type: string }

const SOURCE_LABEL: Record<FranchiseMember['source'], string> = { provider: '', manual: 'attached by hand', wikidata: 'via Wikidata' };
const items = (n: number) => `${n} item${n === 1 ? '' : 's'}`;

function Kind({ children }: { children: string }) {
  return <Text style={styles.kind}>{children}  </Text>;
}

function SuggestionList({ suggestions, busy, onAccept, onReject }: {
  suggestions: FranchiseSuggestion[]; busy: string | null; onAccept: (s: FranchiseSuggestion) => void; onReject: (s: FranchiseSuggestion) => void;
}) {
  if (!suggestions.length) return <Text style={styles.tiny}>No title matches left to review.</Text>;
  return (
    <View style={styles.suggestions}>
      <Text style={[styles.tiny, { color: color.neutral400 }]}>
        {suggestions.length} title match{suggestions.length === 1 ? '' : 'es'}, meaning items whose title says they belong to a franchise the
        catalog already knows, but which carry no provider data. Nothing is applied until you accept it.
      </Text>
      <ScrollView style={{ maxHeight: 288 }} nestedScrollEnabled>
        {suggestions.map((s) => (
          <View key={s.mediaItemId} style={styles.line}>
            <Text numberOfLines={1} style={[styles.text, { flex: 1 }]}>
              <Kind>{s.type}</Kind><Text style={{ color: color.textPrimary }}>{s.title}</Text> → {s.ipLabel}<Text style={styles.kind}>  {s.match}</Text>
            </Text>
            <Button label="Attach" disabled={busy === `sug-${s.mediaItemId}`} onPress={() => onAccept(s)} />
            <Button label="Skip" onPress={() => onReject(s)} />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function Row({ f, all, open, onToggle, busy, act }: { f: FranchiseRow; all: FranchiseRow[]; open: boolean; onToggle: () => void; busy: string | null; act: Act }) {
  const db = useSQLiteContext();
  const [bundleInto, setBundleInto] = useState('');
  const [rename, setRename] = useState('');
  const [search, setSearch] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);

  const term = bundleInto.trim().toLowerCase();
  const matches = term.length < 1 ? [] : all.filter((x) => x.key !== f.key && (x.key.includes(term) || x.label.toLowerCase().includes(term))).slice(0, 8);
  const target = all.find((x) => x.key !== f.key && x.key === bundleInto.trim());

  const runSearch = async () => {
    const q = search.trim();
    if (q.length < 2) return;
    setHits(await db.getAllAsync<Hit>(
      `SELECT DISTINCT c.id, c.title, c.type FROM item_state s JOIN catalog c ON c.id = s.media_item_id
        WHERE s.relation = 'library' AND c.title LIKE ? ORDER BY c.title LIMIT 20`, [`%${q}%`],
    ));
  };
  const submitRename = () => {
    const v = rename.trim();
    if (!v) return;
    void act(`n-${f.key}`, () => api.adminSetLabel('ip', f.key, v)).then((ok) => { if (ok) setRename(''); });
  };
  const bundle = (displayLabel?: string) =>
    void act(`b-${f.key}`, () => api.adminAddAliases('ip', bundleInto.trim(), [f.key], displayLabel)).then((ok) => { if (ok) setBundleInto(''); });

  return (
    <View style={styles.franchise}>
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }} style={styles.franchiseHead}>
        <Text numberOfLines={1} style={[styles.text, { flex: 1, color: color.textPrimary }]}>
          {f.label}{f.aliases.length > 0 ? <Text style={styles.tiny}> · aka {f.aliases.join(', ')}</Text> : null}
        </Text>
        <Text style={styles.tiny}>{items(f.members.length)} · {f.types.join(', ')}</Text>
      </Pressable>
      {open ? (
        <View style={styles.franchiseBody}>
          <View style={styles.wrap}>
            <Text style={[styles.tiny, { color: color.textMuted }]}>Shown as:</Text>
            <Text numberOfLines={1} style={[styles.tiny, { color: color.textPrimary, maxWidth: 220 }]}>{f.label}</Text>
            {f.labelOverridden && f.rawLabel !== f.label ? (
              <Button label={`reset to “${f.rawLabel}”`} disabled={busy === `n-${f.key}`} onPress={() => void act(`n-${f.key}`, () => api.adminClearLabel('ip', f.key))} />
            ) : null}
            <TextInput
              value={rename} onChangeText={setRename} onSubmitEditing={submitRename} editable={busy !== `n-${f.key}`}
              placeholder="Rename, then Enter" placeholderTextColor={color.textSecondary} style={[styles.input, { width: 160, fontSize: 12, paddingVertical: 2 }]}
            />
            {rename.trim() ? <Button label="Rename" onPress={submitRename} disabled={busy === `n-${f.key}`} /> : null}
          </View>

          <View style={{ gap: 4 }}>
            {f.members.map((m) => (
              <View key={m.mediaItemId} style={styles.line}>
                <Text numberOfLines={1} style={[styles.text, { flex: 1 }]}>
                  <Kind>{m.type}</Kind>{m.title ?? m.mediaItemId}
                  {m.source !== 'provider' ? <Text style={styles.kind}>  {SOURCE_LABEL[m.source]}</Text> : null}
                </Text>
                <Button
                  label="Remove" disabled={busy === `m-${m.mediaItemId}`}
                  onPress={() => void act(`m-${m.mediaItemId}`, () => (m.source !== 'provider'
                    // A row somebody added is forgotten. A provider's membership is overruled, and stays overruled.
                    ? api.adminClearIpOverride(m.mediaItemId, f.key)
                    : api.adminIpOverride({ mediaItemId: m.mediaItemId, mode: 'remove', ipKey: f.key, label: f.label })))}
                />
              </View>
            ))}
          </View>

          <View style={styles.wrap}>
            <TextInput
              value={search} onChangeText={setSearch} onSubmitEditing={() => void runSearch()} returnKeyType="search"
              placeholder="Search your library to attach…" placeholderTextColor={color.textSecondary} style={[styles.input, { flex: 1, minWidth: 180 }]}
            />
            <Button label="Search" onPress={() => void runSearch()} />
          </View>
          {hits.length > 0 ? (
            <View style={{ gap: 4 }}>
              {hits.map((h) => (
                <View key={h.id} style={styles.line}>
                  <Text numberOfLines={1} style={[styles.text, { flex: 1 }]}><Kind>{h.type}</Kind>{h.title}</Text>
                  <Button
                    label="Attach" disabled={busy === `a-${h.id}`}
                    onPress={() => void act(`a-${h.id}`, () => api.adminIpOverride({ mediaItemId: h.id, mode: 'add', label: f.label }))
                      .then((ok) => { if (ok) setHits((prev) => prev.filter((x) => x.id !== h.id)); })}
                  />
                </View>
              ))}
            </View>
          ) : null}

          <View style={styles.fold}>
            <View style={styles.wrap}>
              <Text style={styles.tiny}>Fold this franchise into:</Text>
              <TextInput value={bundleInto} onChangeText={setBundleInto} placeholder="Search franchises…" placeholderTextColor={color.textSecondary} autoCapitalize="none" style={[styles.input, { width: 180 }]} />
              {target ? (
                <>
                  <Button label={`Bundle, keep “${target.label}”`} disabled={busy === `b-${f.key}`} onPress={() => bundle()} />
                  <Button label={`Bundle, keep “${f.label}”`} disabled={busy === `b-${f.key}`} onPress={() => bundle(f.label)} />
                </>
              ) : <Button label="Bundle" disabled />}
              {f.aliases.length > 0 ? (
                <Button label="Dissolve bundle" disabled={busy === `d-${f.key}`} onPress={() => void act(`d-${f.key}`, () => api.adminDeleteBundle('ip', f.key))} />
              ) : null}
            </View>
            {term.length > 0 && !target ? (
              matches.length > 0 ? (
                <View>
                  {matches.map((x) => (
                    <Pressable key={x.key} onPress={() => setBundleInto(x.key)} accessibilityRole="button" style={styles.match}>
                      <Text numberOfLines={1} style={styles.tiny}>
                        <Text style={{ color: color.textPrimary }}>{x.label}</Text><Text style={{ fontFamily: font.mono }}> · {x.key}</Text> · {items(x.members.length)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : <Text style={[styles.tiny, { color: color.textMuted }]}>No other franchise matches that.</Text>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

export function FranchisePanel({ json, write }: { json: TaxonomyJson; write: Write }) {
  const db = useSQLiteContext();
  const catalog = useCatalogSync();
  const [titles, setTitles] = useState<CatalogTitle[] | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [order, setOrder] = useState<'name' | 'size'>('name');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void catalogTitles(db).then((t) => { if (live) setTitles(t); });
    return () => { live = false; };
  }, [db, catalog.revision]);

  const franchises = useMemo(() => (titles ? surveyFranchises(titles, json) : []), [titles, json]);
  const suggestions = useMemo(
    () => (suggesting && titles ? suggestFranchisesByTitle(titles, json, franchises).filter((s) => !skipped.has(s.mediaItemId)) : null),
    [suggesting, titles, json, franchises, skipped],
  );

  const act: Act = async (busyKey, run) => {
    setBusy(busyKey);
    const ok = await write(run);
    setBusy(null);
    return ok;
  };

  const term = filter.trim().toLowerCase();
  const shown = (term ? franchises.filter((f) => f.key.includes(term) || f.label.toLowerCase().includes(term)) : franchises)
    .slice()
    .sort((a, b) => (order === 'name'
      ? a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }) || a.key.localeCompare(b.key)
      : b.members.length - a.members.length || a.key.localeCompare(b.key)));

  return (
    <View style={styles.block}>
      <View style={[styles.wrap, { justifyContent: 'space-between' }]}>
        <Text style={styles.blockTitle}>Franchises</Text>
        <View style={styles.wrap}>
          <TextInput value={filter} onChangeText={setFilter} placeholder="Filter franchises…" placeholderTextColor={color.textSecondary} autoCapitalize="none" style={[styles.input, { width: 170 }]} />
          <SortMenu value={order} options={[['name', 'A to Z'], ['size', 'Most items']]} onChange={setOrder} />
          <Button label={suggesting ? 'Refresh suggestions' : 'Find suggestions'} disabled={!titles} onPress={() => { setSkipped(new Set()); setSuggesting(true); }} />
        </View>
      </View>
      <Text style={styles.tiny}>
        A franchise contributes to the Fandex Score through its own weight (Franchise, on the Weights tab). Bundle two names for the same
        franchise so they share one average; attach or detach an item when the provider data is wrong or missing. Shows have no provider
        franchise data at all, because TMDB has no collections for series and IGDB only covers games, so attaching is the only way a
        series joins one.
      </Text>
      {suggestions ? (
        <SuggestionList
          suggestions={suggestions} busy={busy}
          onAccept={(s) => void act(`sug-${s.mediaItemId}`, () => api.adminIpOverride({ mediaItemId: s.mediaItemId, mode: 'add', label: s.ipLabel }))}
          onReject={(s) => setSkipped((prev) => new Set(prev).add(s.mediaItemId))}
        />
      ) : null}
      <View style={{ gap: 4 }}>
        {!titles ? <Text style={styles.text}>Reading the catalog…</Text> : null}
        {titles && !shown.length ? <Text style={styles.text}>No franchises match.</Text> : null}
        {shown.slice(0, 300).map((f) => (
          <Row key={f.key} f={f} all={franchises} open={openKey === f.key} onToggle={() => setOpenKey(openKey === f.key ? null : f.key)} busy={busy} act={act} />
        ))}
        {shown.length > 300 ? <Text style={styles.tiny}>Showing the first 300 of {shown.length}. Filter to find the rest.</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { padding: 16, gap: 16, borderRadius: radius.lg, borderWidth: 1, borderColor: color.border, backgroundColor: color.surfaceElevated },
  blockTitle: { fontFamily: font.sansBold, fontSize: 14, lineHeight: 20, color: color.textPrimary },
  text: { fontFamily: font.sans, fontSize: 14, lineHeight: 20, color: color.textSecondary },
  tiny: { fontFamily: font.sans, fontSize: 12, lineHeight: 16, color: color.textSecondary },
  kind: { fontFamily: font.sans, fontSize: 10, lineHeight: 14, color: color.textMuted, textTransform: 'uppercase' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 },
  input: {
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm, borderWidth: 1, borderColor: color.borderStrong,
    backgroundColor: color.surfaceInset, color: color.textPrimary, fontFamily: font.sans, fontSize: 14,
  },
  suggestions: { padding: 12, gap: 8, borderRadius: radius.md, borderWidth: 1, borderColor: color.border, backgroundColor: color.surfaceInset },
  franchise: { borderRadius: radius.md, borderWidth: 1, borderColor: color.border },
  franchiseHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 12, paddingVertical: 8 },
  franchiseBody: { paddingHorizontal: 12, paddingBottom: 12, paddingTop: 12, gap: 12, borderTopWidth: 1, borderTopColor: color.border },
  fold: { paddingTop: 12, gap: 8, borderTopWidth: 1, borderTopColor: color.border },
  match: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 },
});
