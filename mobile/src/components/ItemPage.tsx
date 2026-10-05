// One title, as everybody sees it: what it is, when it is out, who made it,
// where to get it.
//
// Nothing here knows who is looking. The app's item screen passes its personal
// blocks (your state, your Fandex Score, the rating row) in as `personal`; the
// website renders this same component to HTML for a visitor or a crawler and
// passes nothing. That is the plan's one-component rule (docs/app-plan.md, "The
// website"), so this file must stay free of anything only a device has: no
// database, no session, no router.

import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Poster, T, TypeTag } from '~/components/ui';
import type { ItemDetail } from '~/lib/api';
import { compactCount, longDate, todayIso } from '~/lib/dates';
import { color, radius, space } from '~/theme';

function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <View style={styles.fact}>
      <T variant="eyebrow">{label}</T>
      <T variant="body">{value}</T>
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <T variant="eyebrow">{title}</T>
      {children}
    </View>
  );
}

function runtime(minutes: number | null): string | null {
  if (!minutes) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} h ${m ? `${m} min` : ''}`.trim() : `${m} min`;
}

export function ItemPage({ item, personal, bottomInset = 0 }: {
  item: ItemDetail;
  /** Rendered between the header and the community ratings. */
  personal?: ReactNode;
  /** What the last line has to clear, on a device that draws under its navigation buttons. */
  bottomInset?: number;
}) {
  const m = item.merged;
  const released = longDate(m.releaseDate);
  const upcoming = !!m.releaseDate && m.releaseDate.slice(0, 10) > todayIso();
  const made = item.type === 'game'
    ? [m.developer, m.publisher && m.publisher !== m.developer ? m.publisher : null].filter(Boolean).join(' · ')
    : m.director ?? null;
  const metaLine = [item.vector.year ? String(item.vector.year) : null, runtime(m.runtimeMinutes), m.certification[0]]
    .filter(Boolean)
    .join(' · ');

  return (
    <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: space.section + bottomInset }]}>
      {m.backdropUrl ? <Image source={{ uri: m.backdropUrl }} style={styles.backdrop} contentFit="cover" transition={120} /> : null}

      <View style={styles.head}>
        <Poster uri={m.posterUrl} width={104} kind={item.type} />
        <View style={styles.headBody}>
          <TypeTag kind={item.type} />
          <T variant="serifMd">{m.title}</T>
          {metaLine ? <T variant="meta">{metaLine}</T> : null}
          {released ? (
            <T variant="caption" style={upcoming ? { color: color.accent } : undefined}>
              {upcoming ? `Out ${released}` : `Released ${released}`}
              {item.region !== 'US' && item.type === 'movie' ? ` (${item.region})` : ''}
            </T>
          ) : null}
        </View>
      </View>

      {personal}

      {m.communityRatings.length ? (
        <View style={styles.ratings}>
          {m.communityRatings.map((r) => (
            <View key={r.source} style={styles.rating}>
              {/* Scores arrive on three scales. 100 and 10 read on their own; a
                  bare "4.6" does not, so anything else says what it is out of. */}
              <T variant="title">
                {r.outOf === 100 ? Math.round(r.score) : r.score.toFixed(1)}
                {r.outOf !== 100 && r.outOf !== 10 ? ` / ${r.outOf}` : ''}
              </T>
              <T variant="meta">
                {r.label}
                {r.votes ? ` · ${compactCount(r.votes)}` : ''}
              </T>
            </View>
          ))}
        </View>
      ) : null}

      {m.tagline ? <T variant="serifSm" style={styles.tagline}>{m.tagline}</T> : null}
      {m.description ? <T variant="body" style={styles.block}>{m.description}</T> : null}

      <View style={styles.facts}>
        <Fact label={item.type === 'game' ? 'Made by' : item.type === 'show' ? 'Created by' : 'Directed by'} value={made} />
        <Fact label="Network" value={m.network} />
        <Fact label="Status" value={m.status} />
        <Fact
          label="Seasons"
          value={m.seasonCount ? `${m.seasonCount}${m.episodeCount ? ` · ${m.episodeCount} episodes` : ''}` : null}
        />
        <Fact label="Platforms" value={m.platforms.length ? m.platforms.join(', ') : null} />
      </View>

      {m.streamingProviders.length ? (
        <Section title={`Where to watch · ${item.region}`}>
          <T variant="body">{m.streamingProviders.map((p) => p.name).join(', ')}</T>
        </Section>
      ) : null}

      {m.cast?.length ? (
        <Section title="Cast">
          {m.cast.slice(0, 8).map((c) => (
            <View key={`${c.name}:${c.character ?? ''}`} style={styles.castRow}>
              <T variant="body" style={{ flexShrink: 1 }}>{c.name}</T>
              {c.character ? <T variant="caption" numberOfLines={1} style={styles.castRole}>{c.character}</T> : null}
            </View>
          ))}
        </Section>
      ) : null}

      {m.tags.length ? (
        <Section title="Tags">
          <View style={styles.tags}>
            {m.tags.slice(0, 14).map((t) => (
              <View key={t} style={styles.tag}>
                <T variant="caption">{t}</T>
              </View>
            ))}
          </View>
        </Section>
      ) : null}

      {m.storeLinks.length ? (
        <Section title="Links">
          <View style={styles.tags}>
            {m.storeLinks.slice(0, 10).map((l) => (
              <Pressable
                key={`${l.name}:${l.url}`}
                onPress={() => void Linking.openURL(l.url)}
                accessibilityRole="link"
                accessibilityLabel={`Open ${l.name}`}
                style={({ pressed }) => [styles.link, pressed && { opacity: 0.6 }]}>
                <T variant="label">{l.name}</T>
              </Pressable>
            ))}
          </View>
        </Section>
      ) : null}

      <T variant="meta" style={styles.sourceLine}>
        Data from {[...new Set(m.dates.map((d) => d.source.toUpperCase()))].join(', ') || item.vector.sources.map((s) => s.source.toUpperCase()).join(', ')}
      </T>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: space.section },
  backdrop: { width: '100%', aspectRatio: 16 / 9, backgroundColor: color.surfaceElevated },
  head: { flexDirection: 'row', gap: space.lg, padding: space.lg, alignItems: 'flex-end' },
  headBody: { flex: 1, minWidth: 0, gap: space.xs },
  ratings: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: space.lg },
  rating: {
    paddingHorizontal: space.md, paddingVertical: space.sm, gap: space.xxs,
    borderRadius: radius.md, backgroundColor: color.surfaceElevated, borderWidth: 1, borderColor: color.border,
  },
  tagline: { paddingHorizontal: space.lg, paddingTop: space.lg, color: color.textSecondary },
  block: { paddingHorizontal: space.lg, paddingTop: space.md },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg, padding: space.lg },
  fact: { gap: space.xxs, minWidth: 130, maxWidth: '100%' },
  section: { paddingHorizontal: space.lg, paddingTop: space.lg, gap: space.sm },
  castRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.md },
  castRole: { flex: 1, minWidth: 0 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tag: {
    paddingHorizontal: space.md, paddingVertical: space.xs,
    borderRadius: radius.full, borderWidth: 1, borderColor: color.border,
  },
  link: {
    paddingHorizontal: space.md, minHeight: 44, justifyContent: 'center',
    borderRadius: radius.md, borderWidth: 1, borderColor: color.borderStrong,
  },
  sourceLine: { padding: space.lg, color: color.textMuted },
});
