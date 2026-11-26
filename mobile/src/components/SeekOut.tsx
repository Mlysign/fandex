// Insights' "What you seek out": the tags, people, studios and franchises you
// pick far more often than an ordinary library holds, whatever you rated them
// (lib/seekOut.ts). Nils, 2026-11-26: "If I explain my taste I would say I
// love steampunk, and nothing on Fandex reflects this."
//
// Drawn as the rating sections under it are (a box per kind on one rail, its
// strongest rows, the rest in a sheet), and deliberately without a single
// number on the score's scale: beside the score, pull read as part of it
// (`PULL_SHOWN`, lib/scoreReasons.ts). A row says how many times more often
// than average, and on how many of your titles.

import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { keyToSlug } from '@/lib/facetUrl';
import { RailFrame } from '~/components/cardFace';
import { Button, Eyebrow, Panel, Sheet, SortMenu } from '~/components/kit';
import { pullSentence, timesShort } from '~/lib/scoreReasons';
import { sortSeek, type SeekFacet, type SeekOrder } from '~/lib/seekOut';
import { useSeekOut } from '~/lib/SeekOutProvider';
import { color, font, radius, type } from '~/theme';

/** Rows a box shows; the rest open in a sheet. */
const PER_GROUP = 5;

const ORDERS: [SeekOrder, string][] = [['weight', 'Strongest'], ['times', 'Furthest above average'], ['titles', 'Most titles']];

const KINDS: { kind: SeekFacet['kind']; label: string; tint: string }[] = [
  { kind: 'tag', label: 'Tags', tint: color.facet.tag },
  { kind: 'person', label: 'People', tint: color.facet.person },
  { kind: 'company', label: 'Studios', tint: color.facet.company },
  { kind: 'ip', label: 'Franchises', tint: color.facet.genre },
];

const ROLE_LABEL: Record<string, string> = {
  director: 'Director', writer: 'Writer', creator: 'Creator', cast: 'Cast',
  developer: 'Developer', publisher: 'Publisher', studio: 'Studio', network: 'Network',
};

/** Where a thing you seek out has its page. */
export const seekHref = (f: Pick<SeekFacet, 'kind' | 'key'>): string =>
  `/${f.kind === 'company' ? 'studio' : f.kind === 'ip' ? 'franchise' : f.kind}/${keyToSlug(f.key)}`;

/**
 * One row: the name, a bar for how far above average, the number, and on how
 * many of your titles. The bar is on a log scale against the list's furthest,
 * so twice as often is the same step anywhere on it.
 */
function SeekRow({ f, most, tint, onNavigate }: { f: SeekFacet; most: number; tint: string; onNavigate?: () => void }) {
  const router = useRouter();
  const share = most > 1 ? Math.min(1, Math.log(f.times) / Math.log(most)) : 1;
  const role = f.role ? ROLE_LABEL[f.role] : null;
  return (
    <Pressable
      onPress={() => { onNavigate?.(); router.push(seekHref(f) as never); }}
      accessibilityRole="link"
      accessibilityLabel={pullSentence(f, f.label)}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}>
      <View style={styles.name}>
        <Text numberOfLines={1} style={[type.bodySm, { color: color.textPrimary }]}>{f.label}</Text>
        {role ? <Text numberOfLines={1} style={type.micro}>{role}</Text> : null}
      </View>
      <View style={styles.track}>
        <View style={{ width: `${Math.max(6, share * 100)}%`, height: '100%', borderRadius: 3, backgroundColor: tint, opacity: 0.9 }} />
      </View>
      <Text style={styles.times}>{timesShort(f.times)}</Text>
      <Text numberOfLines={1} style={styles.count}>{f.titles}</Text>
    </Pressable>
  );
}

function ColumnHeads() {
  return (
    <>
      <Text style={[styles.head, { width: 34 }]}>vs avg</Text>
      <Text style={[styles.head, { width: 34 }]}>titles</Text>
    </>
  );
}

/** One kind: its first rows, and every row in a sheet. */
function SeekBox({ label, rows, most, tint }: { label: string; rows: SeekFacet[]; most: number; tint: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Panel style={styles.box}>
      <View style={styles.boxHead}>
        <View style={[styles.dot, { backgroundColor: tint }]} />
        <Text numberOfLines={1} style={[type.bodySm, { flexShrink: 1, color: color.textPrimary }]}>{label}</Text>
        <Text style={[type.caption, { flex: 1 }]}>{rows.length}</Text>
        <ColumnHeads />
      </View>
      {rows.slice(0, PER_GROUP).map((f) => <SeekRow key={f.id} f={f} most={most} tint={tint} />)}
      {rows.length > PER_GROUP ? (
        <Pressable onPress={() => setOpen(true)} accessibilityRole="button" hitSlop={8} style={({ pressed }) => [styles.more, pressed && { opacity: 0.6 }]}>
          <Text style={[type.caption, { color: color.accent }]}>Show all {rows.length}</Text>
        </Pressable>
      ) : null}
      <Sheet open={open} onClose={() => setOpen(false)} title={label}>
        <View style={styles.sheetHead}>
          <Text style={type.title}>{label}</Text>
          <Text style={[type.caption, { flex: 1 }]}>{rows.length}</Text>
          <ColumnHeads />
        </View>
        {/* A row opens its page, so the sheet closes first or it would cover that page. */}
        <ScrollView style={{ maxHeight: 560 }} contentContainerStyle={styles.sheetBody}>
          {rows.map((f) => <SeekRow key={f.id} f={f} most={most} tint={tint} onNavigate={() => setOpen(false)} />)}
        </ScrollView>
      </Sheet>
    </Panel>
  );
}

export function SeekOutSection({ boxWidth }: { boxWidth: number }) {
  const router = useRouter();
  const seek = useSeekOut();
  const [order, setOrder] = useState<SeekOrder>('weight');
  const groups = useMemo(() => KINDS
    .map((k) => ({ ...k, rows: sortSeek(seek.facets.filter((f) => f.kind === k.kind), order) }))
    .filter((g) => g.rows.length), [seek.facets, order]);
  const most = useMemo(() => seek.facets.reduce((m, f) => Math.max(m, f.times), 1), [seek.facets]);

  if (seek.status === 'off') return null;
  const note = (text: string, busy = false) => (
    <View style={styles.note}>
      {busy ? <ActivityIndicator color={color.accent} /> : null}
      <Text style={[type.caption, { flexShrink: 1 }]}>{text}</Text>
    </View>
  );
  return (
    <View style={styles.section}>
      <Eyebrow>What you seek out</Eyebrow>
      <Text style={[type.caption, { marginTop: 4, marginBottom: 12 }]}>
        What you pick far more often than an ordinary library holds, whatever you rated it.
        {seek.status === 'ready' && seek.baseline
          ? ` Your ${seek.picks.toLocaleString('en')} titles, wishlist included, against ${seek.baseline.toLocaleString('en')} ordinary ones drawn at random.`
          : ''}
        {' '}This is not part of your Fandex Score, which goes by your ratings alone.
      </Text>
      {seek.status === 'idle' || seek.status === 'working' ? note('Working out what you seek out…', true)
        : seek.status === 'no-baseline' ? note('Fandex is still fetching the ordinary titles your picks are compared with. This fills in on its own.')
        : seek.status === 'no-picks' ? note('Nothing in your library or wishlist to compare yet.')
        : !groups.length ? note('Nothing stands out yet. It takes a few titles of one kind before Fandex calls it a habit, so this fills in as your library grows.')
        : (
          <>
            <View style={styles.metaRow}>
              <Text style={[type.micro, { color: color.accent, letterSpacing: 0.8 }]}>
                {`things you seek out · ${seek.facets.length}${seek.updating ? ' · updating…' : ''}`}
              </Text>
              <SortMenu value={order} options={ORDERS} onChange={setOrder} />
            </View>
            <RailFrame title="What you seek out" headless>
              {groups.map((g) => (
                <View key={g.kind} style={{ width: boxWidth }}>
                  <SeekBox label={g.label} rows={g.rows} most={most} tint={g.tint} />
                </View>
              ))}
            </RailFrame>
            <View style={{ flexDirection: 'row', marginTop: 12 }}>
              <Button label="See what these recommend" variant="secondary" size="md" onPress={() => router.push('/recommendations' as never)} />
            </View>
          </>
        )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 40 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 30, marginBottom: 12 },
  note: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 24 },
  // Grows to the rail's tallest box, as Insights' rating boxes do.
  box: { flexGrow: 1, padding: 12, borderRadius: radius.xl },
  boxHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8, paddingHorizontal: 4 },
  dot: { width: 8, height: 8, borderRadius: radius.full },
  head: { textAlign: 'right', fontFamily: font.mono, fontSize: 8, lineHeight: 10, letterSpacing: 0.48, textTransform: 'uppercase', color: color.textSecondary },
  more: { alignSelf: 'flex-start', paddingTop: 6, paddingHorizontal: 4 },
  sheetHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingHorizontal: 18, paddingTop: 10 },
  sheetBody: { padding: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 34, paddingHorizontal: 4 },
  name: { flex: 1, minWidth: 0 },
  track: { width: 56, height: 6, borderRadius: 3, backgroundColor: color.surfaceInset, overflow: 'hidden' },
  // Fixed widths from here right, so every bar in a box starts on the same line.
  times: { width: 34, textAlign: 'right', fontFamily: font.sansBold, fontSize: 12, lineHeight: 15, fontVariant: ['tabular-nums'], color: color.accent },
  count: { width: 34, textAlign: 'right', fontFamily: font.mono, fontSize: 10, lineHeight: 12, color: color.textSecondary },
});
