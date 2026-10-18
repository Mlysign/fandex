// The head of a tag, person or studio page: back, what kind of page it is, the
// name, the numbers, and whatever the page adds under them.
//
// Pure, so the website's build can render it on a server for the static facet
// pages (mobile/web/render.tsx) and the app's FacetScreen draws the same thing.
// Anything that needs the app (the Fandex impact, the sort menu, a biography
// that opens on a tap) comes in as a slot.

import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { StatStrip } from '~/components/kit';
import { ROLE_LABEL } from '~/lib/creditLine';
import { color, radius, type } from '~/theme';

export type FacetKind = 'tag' | 'person' | 'studio' | 'franchise';

export const KIND_LABEL: Record<FacetKind, string> = { tag: 'Tag', person: 'Person', studio: 'Studio', franchise: 'Franchise' };
export { ROLE_LABEL };

/** The line over the name: "Tag", "Franchise", or a person's or a studio's roles, most frequent first. */
export function facetEyebrow(kind: FacetKind, roles: string[]): string {
  if (kind === 'tag' || kind === 'franchise') return KIND_LABEL[kind];
  return roles.length ? roles.map((r) => ROLE_LABEL[r] ?? r).join(' · ') : KIND_LABEL[kind];
}

export function FacetHeader({ back, eyebrow, name, avatar, life, bio, tiles, extra, count, sort }: {
  back: ReactNode;
  eyebrow: string;
  name: string;
  avatar?: ReactNode;
  life?: string;
  bio?: ReactNode;
  tiles: { label: string; value: string }[];
  /** Under the numbers: the Fandex impact lines in the app. */
  extra?: ReactNode;
  /** The "titles · N" line. */
  count: string;
  sort?: ReactNode;
}) {
  return (
    <View style={styles.header}>
      {back}
      <Text style={[type.eyebrow, { color: color.accent }]}>{eyebrow}</Text>
      <View style={styles.who}>
        {avatar}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text accessibilityRole="header" style={[type.serifXl, { marginTop: 6 }]}>{name}</Text>
          {life ? <Text style={[type.meta, { marginTop: 4 }]}>{life}</Text> : null}
        </View>
      </View>
      {bio}
      <View style={{ marginTop: 16 }}><StatStrip cells={tiles} /></View>
      {extra}
      <View style={styles.sortRow}>
        <Text style={[type.micro, { color: color.accent, letterSpacing: 0.8 }]}>{count}</Text>
        {sort}
      </View>
    </View>
  );
}

/** The round back button's look, for the app's Pressable and the static page's link. */
export const backButtonStyle = {
  width: 36, height: 36, marginBottom: 16, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center',
  backgroundColor: color.surfaceElevated, borderWidth: 1, borderColor: color.border,
} as const;

const styles = StyleSheet.create({
  header: { paddingBottom: 16 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  sortRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, minHeight: 30 },
});
