// A person on Home's "Popular people" rail. A port of the site's
// src/components/PersonCard.tsx: a 110 px circle (a person at a glance, and
// what tells this rail apart from the poster rails), the name on two lines,
// and the role with the title count under it.

import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import { Img } from '~/components/Img';
import { color, font, radius, type } from '~/theme';

export interface PopularPerson {
  key: string;
  name: string;
  href: string;
  portraitUrl: string | null;
  titleCount: number;
  topRole: string;
  /** The medium most of their titles are. Absent in a people file written before 2026-10-18. */
  topType?: string;
}

/** The site's roleLabel (src/lib/personRail.ts). A book's creator is its author, a board game's its designer. */
export function roleLabel(role: string, topType?: string): string {
  switch (role) {
    case 'director': return 'Director';
    case 'writer': return 'Writer';
    case 'creator': return topType === 'book' ? 'Author' : topType === 'boardgame' ? 'Designer' : 'Creator';
    case 'cast': return 'Actor';
    default: return role.charAt(0).toUpperCase() + role.slice(1);
  }
}

/** "Guillermo del Toro" → "GT". */
function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return ((parts[0][0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '')).toUpperCase();
}

export function PersonCard({ person }: { person: PopularPerson }) {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const onPress = (e?: GestureResponderEvent) => {
    (e as unknown as { preventDefault?: () => void } | undefined)?.preventDefault?.();
    router.push(person.href as never);
  };
  return (
    <Pressable
      {...(Platform.OS === 'web' ? ({ href: person.href } as object) : null)}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole="link"
      accessibilityLabel={`${person.name}, ${roleLabel(person.topRole, person.topType)}`}
      style={styles.card}>
      <View style={[styles.circle, hovered && { borderColor: color.borderStrong }]}>
        {person.portraitUrl && !failed
          ? <Img uri={person.portraitUrl} width={110} alt="" style={styles.fill} onError={() => setFailed(true)} />
          : <Text style={[type.serifMd, { color: color.textSecondary }]}>{initials(person.name)}</Text>}
      </View>
      <Text numberOfLines={2} style={[styles.name, hovered && { textDecorationLine: 'underline' }]}>{person.name}</Text>
      <Text style={[type.label, { color: color.textSecondary, marginTop: 2 }]}>
        {roleLabel(person.topRole, person.topType)} · {person.titleCount} titles
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { width: 110 },
  circle: {
    width: 110, height: 110, borderRadius: radius.full, overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
    backgroundColor: color.surfaceElevated, borderWidth: 1, borderColor: color.border,
  },
  fill: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
  name: { marginTop: 8, paddingHorizontal: 2, fontFamily: font.sans, fontSize: 14, lineHeight: 20, color: color.textPrimary },
});
