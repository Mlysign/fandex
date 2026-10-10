// Scoring admin, "Taxonomy": the categories and the tags. A port of the site's
// src/app/dev/scoring/TaxonomyPanel.tsx and TagTable.tsx.
//
// The table's rows are counted on the device (lib/tagVocab.ts) from the same
// catalog every other screen reads; the site asked its server. Every write goes
// to the Worker and comes back as the whole taxonomy, which the rows are then
// rebuilt from, so the table never shows what it sent in place of what was stored.
//
// Franchises is its own file (FranchisePanel.tsx). Not here yet: the Review section.
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { tagCategoryHex } from '@/lib/facetPalette';
import { slugify } from '@/lib/slug';
import { Button, Sheet } from '~/components/kit';
import { api, ApiError } from '~/lib/api';
import { useCatalogSync } from '~/lib/CatalogSyncProvider';
import type { TaxonomyJson } from '~/lib/fandexScore';
import { buildTagRows, filterTagRows, rawTagCounts, type TagRow } from '~/lib/tagVocab';
import { breakpoint, color, font, radius } from '~/theme';
import { FranchisePanel } from './FranchisePanel';
import type { Category } from './WeightsPanel';

type Section = 'categories' | 'tags' | 'franchises';
const SECTIONS: [Section, string][] = [['categories', 'Categories'], ['tags', 'Tags'], ['franchises', 'Franchises']];
const PAGE_SIZE = 100;

/** A write to the Worker: the taxonomy it answers with, or the reason it did not happen. */
type Write = (run: () => Promise<TaxonomyJson>) => Promise<boolean>;

const reason = (e: unknown) => (e instanceof ApiError && e.message ? e.message : e instanceof Error ? e.message : 'That did not save.');

/** A native select has no equal in React Native. This is a button that opens the options in a sheet. */
function Select({ value, options, onChange, placeholder, disabled, width, label }: {
  value: string; options: [string, string][]; onChange: (v: string) => void; placeholder?: string; disabled?: boolean; width?: number; label: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find(([k]) => k === value)?.[1] ?? placeholder ?? '';
  return (
    <>
      <Pressable onPress={() => setOpen(true)} disabled={disabled} accessibilityRole="button" accessibilityLabel={`${label}: ${current}`} style={[styles.input, styles.select, { width }, disabled && { opacity: 0.5 }]}>
        <Text numberOfLines={1} style={[styles.text, { flex: 1, color: color.textPrimary }]}>{current}</Text>
        <Text style={styles.tiny}>▾</Text>
      </Pressable>
      <Sheet open={open} onClose={() => setOpen(false)} title={label}>
        <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ paddingVertical: 8 }}>
          {options.map(([k, text]) => (
            <Pressable key={k} onPress={() => { setOpen(false); onChange(k); }} accessibilityRole="button" style={styles.option}>
              <Text style={[styles.text, { flex: 1, color: k === value ? color.accent : color.textPrimary }]}>{text}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </Sheet>
    </>
  );
}

function Check({ on, mixed, onPress, label }: { on: boolean; mixed?: boolean; onPress: () => void; label: string }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="checkbox" accessibilityState={{ checked: mixed ? 'mixed' : on }} accessibilityLabel={label} style={[styles.box, (on || mixed) && styles.boxOn]}>
      {mixed && !on ? <View style={styles.boxDash} /> : null}
    </Pressable>
  );
}

// ── Categories ───────────────────────────────────────────────────────────────

function CategoryList({ categories, write }: { categories: Category[]; write: Write }) {
  const [label, setLabel] = useState('');
  const [idOverride, setIdOverride] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const derived = slugify(label);
  const id = idOverride ?? derived;

  const add = async () => {
    setBusy('new');
    const ok = await write(() => api.adminSaveCategory({ id, label, color: tagCategoryHex(id), weight: 1, ignored: false }));
    if (ok) { setLabel(''); setIdOverride(null); }
    setBusy(null);
  };
  const remove = async (cid: string) => {
    setBusy(cid);
    await write(() => api.adminDeleteCategory(cid));
    setBusy(null);
  };

  return (
    <View style={styles.block}>
      <Text style={styles.blockTitle}>Categories</Text>
      <Text style={styles.tiny}>
        Weight/ignored are edited in the Weights &amp; Tuning tab. This is id/label, and creating or removing a category. Colour is not
        per-category: every tag renders in the shared tag colour, except genre, which gets the brand gold.
      </Text>
      <View style={{ gap: 6 }}>
        {categories.map((c) => (
          <View key={c.id} style={styles.row}>
            <View style={[styles.dot, { backgroundColor: tagCategoryHex(c.id) }]} />
            <Text numberOfLines={1} style={[styles.tiny, { width: 112, fontFamily: font.mono }]}>{c.id}</Text>
            <Text numberOfLines={1} style={[styles.text, { flex: 1, color: color.neutral400 }]}>{c.label}</Text>
            <Text style={[styles.tiny, { color: color.textMuted }]}>{c.ignored ? 'ignored' : `w=${c.weight}`}</Text>
            <Pressable onPress={() => void remove(c.id)} disabled={busy === c.id} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Delete ${c.label}`}>
              <Text style={[styles.tiny, busy === c.id && { opacity: 0.5 }]}>Delete</Text>
            </Pressable>
          </View>
        ))}
      </View>
      <View style={[styles.newRow, { gap: 6 }]}>
        <View style={styles.row}>
          <TextInput value={label} onChangeText={setLabel} placeholder="Label (e.g. People & Characters)" placeholderTextColor={color.textSecondary} style={[styles.input, { flex: 1, minWidth: 0 }]} />
          <Button label="Add" onPress={() => void add()} disabled={busy === 'new' || !label || !id} />
        </View>
        {idOverride !== null ? (
          <TextInput value={idOverride} onChangeText={setIdOverride} placeholder="id (lowercase-kebab)" placeholderTextColor={color.textSecondary} autoCapitalize="none" style={[styles.input, { width: 192 }]} />
        ) : (
          <View style={styles.row}>
            <Text style={styles.tiny}>id: <Text style={{ fontFamily: font.mono, color: color.neutral400 }}>{derived || '-'}</Text></Text>
            <Pressable onPress={() => setIdOverride(derived)} hitSlop={8} accessibilityRole="button"><Text style={styles.link}>edit</Text></Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

// ── Tags ─────────────────────────────────────────────────────────────────────

function AkaEditor({ row, all, busy, onRemove, onAdd }: {
  row: TagRow; all: TagRow[]; busy: string | null; onRemove: (alias: string) => void; onAdd: (canonical: string, member: string) => void;
}) {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const results = useMemo(() => {
    const term = query.trim();
    if (!searching || term.length < 2) return [];
    const taken = new Set(row.aka.map((a) => a.key));
    return filterTagRows(all, '', term).filter((t) => t.key !== row.key && !taken.has(t.key)).slice(0, 10);
  }, [all, query, searching, row]);

  return (
    <View style={{ gap: 4 }}>
      <View style={styles.chips}>
        {row.aka.map((a) => (
          <View key={a.key} style={styles.chip}>
            <Text style={styles.tiny}>{a.label} <Text style={{ color: color.textMuted }}>{a.count}×</Text></Text>
            <Pressable onPress={() => onRemove(a.key)} disabled={busy === a.key} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${a.label} from ${row.label}`}>
              <Text style={[styles.tiny, busy === a.key && { opacity: 0.5 }]}>×</Text>
            </Pressable>
          </View>
        ))}
        {searching ? (
          <TextInput
            autoFocus value={query} onChangeText={setQuery} placeholder="Find a tag to add…" placeholderTextColor={color.textSecondary}
            autoCapitalize="none" autoCorrect={false} onSubmitEditing={() => setSearching(false)}
            style={[styles.input, { width: 140, paddingVertical: 2, fontSize: 12 }]}
          />
        ) : (
          <Pressable onPress={() => setSearching(true)} hitSlop={8} accessibilityRole="button"><Text style={styles.link}>+ add</Text></Pressable>
        )}
        {searching ? <Pressable onPress={() => { setSearching(false); setQuery(''); }} hitSlop={8} accessibilityRole="button"><Text style={styles.link}>cancel</Text></Pressable> : null}
      </View>
      {results.length ? (
        <View style={styles.results}>
          {results.map((t) => (
            <Pressable key={t.key} onPress={() => { onAdd(row.key, t.key); setQuery(''); setSearching(false); }} accessibilityRole="button" style={styles.result}>
              <Text numberOfLines={1} style={styles.tiny}><Text style={{ color: color.textPrimary }}>{t.label}</Text> {t.count}×</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function DisplayNamePicker({ row, busy, onSet }: { row: TagRow; busy: string | null; onSet: (key: string, label: string | null) => void }) {
  const [custom, setCustom] = useState('');
  const [editing, setEditing] = useState(false);
  const disabled = busy === row.key;
  const options = [...new Set(row.aka.map((a) => a.label))].filter((l) => l !== row.label);
  const submit = () => { if (custom.trim()) { onSet(row.key, custom.trim()); setCustom(''); setEditing(false); } };
  return (
    <View style={styles.chips}>
      <Text style={[styles.tiny, { color: color.textMuted }]}>Shown as:</Text>
      <Text numberOfLines={1} style={[styles.tiny, { color: color.neutral400, maxWidth: 128 }]}>{row.label}</Text>
      {editing ? (
        <>
          <TextInput autoFocus value={custom} onChangeText={setCustom} onSubmitEditing={submit} placeholder="Type a name, Enter" placeholderTextColor={color.textSecondary} style={[styles.input, { width: 144, paddingVertical: 2, fontSize: 12 }]} />
          <Pressable onPress={submit} hitSlop={8} accessibilityRole="button"><Text style={styles.link}>save</Text></Pressable>
          <Pressable onPress={() => { setEditing(false); setCustom(''); }} hitSlop={8} accessibilityRole="button"><Text style={styles.link}>cancel</Text></Pressable>
        </>
      ) : (
        <>
          {options.map((label) => (
            <Pressable key={label} disabled={disabled} onPress={() => onSet(row.key, label)} accessibilityRole="button" accessibilityLabel={`Show this tag as ${label} everywhere`} style={[styles.chip, disabled && { opacity: 0.5 }]}>
              <Text numberOfLines={1} style={[styles.tiny, { color: color.textPrimary, maxWidth: 128 }]}>{label}</Text>
            </Pressable>
          ))}
          <Pressable disabled={disabled} onPress={() => setEditing(true)} hitSlop={8} accessibilityRole="button"><Text style={styles.link}>custom</Text></Pressable>
          {row.labelOverridden ? <Pressable disabled={disabled} onPress={() => onSet(row.key, null)} hitSlop={8} accessibilityRole="button"><Text style={styles.link}>reset</Text></Pressable> : null}
        </>
      )}
    </View>
  );
}

function TagTable({ categories, json, write }: { categories: Category[]; json: TaxonomyJson; write: Write }) {
  const db = useSQLiteContext();
  const catalog = useCatalogSync();
  const { width } = useWindowDimensions();
  const wide = width >= breakpoint.md;
  const [raw, setRaw] = useState<Awaited<ReturnType<typeof rawTagCounts>> | null>(null);
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCategory, setBulkCategory] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void rawTagCounts(db).then((r) => { if (live) setRaw(r); });
    return () => { live = false; };
  }, [db, catalog.revision]);
  useEffect(() => { setLimit(PAGE_SIZE); setSelected(new Set()); }, [filter, search]);

  const all = useMemo(() => (raw ? buildTagRows(raw, json) : []), [raw, json]);
  const matching = useMemo(() => filterTagRows(all, filter, search), [all, filter, search]);
  const rows = matching.slice(0, limit);
  const categoryOptions = categories.map((c): [string, string] => [c.id, c.label]);
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.key));

  const run = async (key: string, call: () => Promise<TaxonomyJson>) => {
    setBusy(key);
    await write(call);
    setBusy(null);
  };
  const toggle = (key: string) => setSelected((prev) => { const next = new Set(prev); if (!next.delete(key)) next.add(key); return next; });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.key)));
  const applyBulk = async () => {
    if (!bulkCategory || selected.size === 0) return;
    setBulkBusy(true);
    if (await write(() => api.adminTagOverrides([...selected], bulkCategory))) { setSelected(new Set()); setBulkCategory(''); }
    setBulkBusy(false);
  };

  return (
    <View style={styles.block}>
      <View style={[styles.row, { flexWrap: 'wrap', justifyContent: 'space-between' }]}>
        <Text style={styles.blockTitle}>Tags</Text>
        <View style={styles.row}>
          <TextInput value={search} onChangeText={setSearch} placeholder="Search tags…" placeholderTextColor={color.textSecondary} autoCapitalize="none" autoCorrect={false} style={[styles.input, { width: 160 }]} />
          <Select label="Category" value={filter} onChange={setFilter} options={[['', 'All categories'], ...categoryOptions]} width={150} />
        </View>
      </View>
      <View style={[styles.row, { flexWrap: 'wrap', justifyContent: 'space-between' }]}>
        <Text style={styles.tiny}>
          {!raw ? 'Counting the catalog…' : `${rows.length} of ${matching.length} tag${matching.length === 1 ? '' : 's'} shown, by catalog frequency.`}
        </Text>
        {rows.length > 0 ? <Pressable onPress={toggleAll} hitSlop={8} accessibilityRole="button"><Text style={styles.link}>{allSelected ? 'Clear selection' : `Select all ${rows.length} shown`}</Text></Pressable> : null}
      </View>

      {selected.size > 0 ? (
        <View style={styles.bulk}>
          <Text style={[styles.text, { color: color.textPrimary }]}>{selected.size} selected</Text>
          <Text style={styles.tiny}>Set category to</Text>
          <Select label="Set category to" value={bulkCategory} onChange={setBulkCategory} options={categoryOptions} placeholder="Choose…" disabled={bulkBusy} width={160} />
          <Button label={bulkBusy ? 'Applying…' : `Apply to ${selected.size}`} onPress={() => void applyBulk()} disabled={!bulkCategory || bulkBusy} />
          <Pressable onPress={() => setSelected(new Set())} disabled={bulkBusy} hitSlop={8} accessibilityRole="button"><Text style={styles.link}>Clear</Text></Pressable>
        </View>
      ) : null}

      <View>
        {wide ? (
          <View style={[styles.tagRow, styles.tagHead]}>
            <View style={[styles.row, { flex: 1, minWidth: 0 }]}>
              <Check on={allSelected} mixed={selected.size > 0} onPress={toggleAll} label="Select all shown tags" />
              <Text style={styles.head}>Tag</Text>
            </View>
            <Text style={[styles.head, { width: 56, textAlign: 'right' }]}>Count</Text>
            <Text style={[styles.head, { width: 144 }]}>Category</Text>
            <Text style={[styles.head, { width: 288 }]}>Aka</Text>
          </View>
        ) : null}
        {rows.map((r) => (
          <View key={r.key} style={[styles.tagRow, !wide && { flexDirection: 'column', alignItems: 'stretch', gap: 6 }]}>
            <View style={[styles.row, { flex: wide ? 1 : undefined, minWidth: 0 }]}>
              <Check on={selected.has(r.key)} onPress={() => toggle(r.key)} label={`Select ${r.label}`} />
              <Text numberOfLines={1} style={[styles.text, { flex: 1, color: color.neutral400 }]}>
                {r.label}{r.labelOverridden ? <Text style={[styles.tiny, { color: color.textMuted, fontSize: 10 }]}>  renamed</Text> : null}
              </Text>
              {!wide ? <Text style={[styles.tiny, { color: color.textMuted }]}>{r.count}×</Text> : null}
            </View>
            {wide ? <Text style={[styles.tiny, { width: 56, textAlign: 'right', color: color.textMuted }]}>{r.count}×</Text> : null}
            <Select
              label={`Category of ${r.label}`} value={r.category} options={categoryOptions} disabled={busy === r.key} width={wide ? 144 : undefined}
              onChange={(cid) => void run(r.key, () => api.adminTagOverrides([r.key], cid))}
            />
            <View style={[{ gap: 4 }, wide && { width: 288 }]}>
              <AkaEditor
                row={r} all={all} busy={busy}
                onRemove={(alias) => void run(alias, () => api.adminDeleteAlias('tag', alias))}
                onAdd={(canonical, member) => void run(member, () => api.adminAddAliases('tag', canonical, [member]))}
              />
              {r.aka.length > 0 ? (
                <DisplayNamePicker
                  row={r} busy={busy}
                  onSet={(key, label) => void run(key, () => (label ? api.adminSetLabel('tag', key, label) : api.adminClearLabel('tag', key)))}
                />
              ) : null}
            </View>
          </View>
        ))}
        {raw && rows.length === 0 ? <Text style={[styles.text, { paddingVertical: 8 }]}>No tags match.</Text> : null}
      </View>
      {rows.length < matching.length ? (
        <Pressable onPress={() => setLimit((n) => n + PAGE_SIZE)} hitSlop={8} accessibilityRole="button">
          <Text style={styles.tiny}>Load {Math.min(PAGE_SIZE, matching.length - rows.length)} more…</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ── The tab ──────────────────────────────────────────────────────────────────

export function TaxonomyPanel({ json, onChanged }: {
  json: TaxonomyJson;
  /** Take the taxonomy a write answered with: the page and the app's own scores both switch to it. */
  onChanged: (next: TaxonomyJson) => Promise<void>;
}) {
  const [section, setSection] = useState<Section>('tags');
  const [error, setError] = useState<string | null>(null);

  const write: Write = async (run) => {
    setError(null);
    try {
      await onChanged(await run());
      return true;
    } catch (e) {
      setError(reason(e));
      return false;
    }
  };

  return (
    <View style={{ gap: 16 }}>
      <View style={styles.sections}>
        {SECTIONS.map(([key, label]) => (
          <Pressable key={key} onPress={() => setSection(key)} accessibilityRole="button" accessibilityState={{ selected: section === key }} style={[styles.section, section === key && styles.sectionOn]}>
            <Text style={[styles.text, section === key && { color: color.textPrimary }]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {error ? <Text style={[styles.tiny, { color: color.danger }]}>{error}</Text> : null}
      {section === 'categories' ? <CategoryList categories={json.tagCategories} write={write} /> : null}
      {section === 'tags' ? <TagTable categories={json.tagCategories} json={json} write={write} /> : null}
      {section === 'franchises' ? <FranchisePanel json={json} write={write} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { padding: 16, gap: 12, borderRadius: radius.lg, borderWidth: 1, borderColor: color.border, backgroundColor: color.surfaceElevated },
  blockTitle: { fontFamily: font.sansBold, fontSize: 14, lineHeight: 20, color: color.textPrimary },
  text: { fontFamily: font.sans, fontSize: 14, lineHeight: 20, color: color.textSecondary },
  tiny: { fontFamily: font.sans, fontSize: 12, lineHeight: 16, color: color.textSecondary },
  link: { fontFamily: font.sans, fontSize: 12, lineHeight: 16, color: color.textSecondary, textDecorationLine: 'underline', textDecorationStyle: 'dotted' },
  head: { fontFamily: font.sans, fontSize: 11, lineHeight: 14, color: color.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: radius.full },
  newRow: { paddingTop: 8, borderTopWidth: 1, borderTopColor: color.border },
  input: {
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm, borderWidth: 1, borderColor: color.borderStrong,
    backgroundColor: color.surfaceInset, color: color.textPrimary, fontFamily: font.sans, fontSize: 14,
  },
  select: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 30 },
  option: { minHeight: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20 },
  box: { width: 16, height: 16, borderRadius: 3, borderWidth: 1, borderColor: color.borderStrong, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: color.neutral400, borderColor: color.neutral400 },
  boxDash: { width: 8, height: 2, backgroundColor: color.surface },
  sections: { flexDirection: 'row', gap: 6 },
  section: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.sm },
  sectionOn: { backgroundColor: color.neutral800 },
  bulk: {
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: radius.md, borderWidth: 1, borderColor: color.borderStrong, backgroundColor: color.surface,
  },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: color.border },
  tagHead: { paddingBottom: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 6, paddingRight: 4, paddingVertical: 2, borderRadius: 4, backgroundColor: color.neutral800 },
  results: { borderRadius: radius.sm, borderWidth: 1, borderColor: color.borderStrong, backgroundColor: color.surface, maxHeight: 160, overflow: 'hidden' },
  result: { paddingHorizontal: 8, paddingVertical: 4 },
});
