// You. The site's profile page (src/app/profile/ProfilePageClient.tsx): who you
// are, three counts, the rows that lead to your pages, Sign out, what you added
// lately, what is coming up, and a rail of recommendations.
//
// Signed out it is where you sign in. Not here yet: the Insights row (the page
// does not exist) and the Support Fandex row.

import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Bookmark, ChevronRight, Settings as SettingsIcon, Star } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CardRail } from '~/components/cards';
import { Avatar, Button } from '~/components/kit';
import { LegalLinks } from '~/components/LegalLinks';
import { SignIn } from '~/components/SignIn';
import { Screen } from '~/components/ui';
import { useAuth } from '~/lib/AuthProvider';
import { useCatalogSync } from '~/lib/CatalogSyncProvider';
import { shortDate, todayIso } from '~/lib/dates';
import { useHomeRails } from '~/lib/useHomeRails';
import { useTypeFilter } from '~/lib/typeFilter';
import { color, radius, type } from '~/theme';

interface Line { id: string; type: string; title: string; when: string | null }
interface Stats { tracked: number; rated: number; wishlist: number; recent: Line[]; coming: Line[] }

function TitleLines({ title, seeAll, lines }: { title: string; seeAll: string; lines: Line[] }) {
  const router = useRouter();
  if (!lines.length) return null;
  return (
    <View>
      <View style={styles.sectionHead}>
        <Text accessibilityRole="header" style={type.serifMd}>{title}</Text>
        <Text accessibilityRole="link" onPress={() => router.push(seeAll as never)} style={[type.label, { color: color.textSecondary }]}>See all</Text>
      </View>
      <View style={{ gap: 6 }}>
        {lines.map((l) => (
          <Pressable
            key={l.id}
            onPress={() => router.push(`/item/${l.id}`)}
            accessibilityRole="link"
            style={({ pressed }) => [styles.line, pressed && { opacity: 0.7 }]}>
            <View style={[styles.dot, { backgroundColor: color.media[l.type] ?? '#888' }]} />
            <Text numberOfLines={1} style={[type.bodySm, { flex: 1, color: color.textPrimary }]}>{l.title}</Text>
            <Text style={type.meta}>{l.when ?? 'TBA'}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default function ProfileScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const auth = useAuth();
  const catalog = useCatalogSync();
  const types = useTypeFilter();
  const rails = useHomeRails();
  const [stats, setStats] = useState<Stats | null>(null);

  const signedIn = auth.status === 'signedIn';
  useEffect(() => {
    let live = true;
    if (!signedIn) {
      setStats(null);
      return;
    }
    (async () => {
      const counts = await db.getFirstAsync<{ tracked: number; rated: number; wishlist: number }>(
        `SELECT COUNT(DISTINCT CASE WHEN s.relation = 'library' THEN s.media_item_id END) AS tracked,
                COUNT(DISTINCT CASE WHEN s.relation = 'library' AND s.rating > 0 THEN s.media_item_id END) AS rated,
                COUNT(DISTINCT CASE WHEN s.relation = 'wishlist' THEN s.media_item_id END) AS wishlist
           FROM item_state s JOIN catalog c ON c.id = s.media_item_id`,
      );
      const recent = await db.getAllAsync<{ id: string; type: string; title: string; added_at: number }>(
        `SELECT c.id, c.type, c.title, MIN(s.added_at) AS added_at
           FROM item_state s JOIN catalog c ON c.id = s.media_item_id
          WHERE s.relation = 'library' GROUP BY c.id ORDER BY added_at DESC LIMIT 5`,
      );
      const coming = await db.getAllAsync<{ id: string; type: string; title: string; release_date: string }>(
        `SELECT DISTINCT c.id, c.type, c.title, c.release_date
           FROM item_state s JOIN catalog c ON c.id = s.media_item_id
          WHERE c.release_date >= ? ORDER BY c.release_date, c.title LIMIT 5`,
        [todayIso()],
      );
      if (!live) return;
      setStats({
        tracked: counts?.tracked ?? 0, rated: counts?.rated ?? 0, wishlist: counts?.wishlist ?? 0,
        recent: recent.map((r) => ({ id: r.id, type: r.type, title: r.title, when: shortDate(r.added_at) })),
        coming: coming.map((r) => ({ id: r.id, type: r.type, title: r.title, when: shortDate(r.release_date) })),
      });
    })();
    return () => { live = false; };
  }, [db, signedIn, auth.rowsRevision, catalog.revision]);

  if (auth.status === 'loading') {
    return <Screen><View style={styles.main}><ActivityIndicator color={color.accent} /></View></Screen>;
  }

  if (!signedIn) {
    return (
      <Screen>
        <ScrollView contentContainerStyle={styles.main}>
          <SignIn
            title="Sign in to see your profile"
            hint="Your counts, what you added recently and what is coming up all live behind a sign-in. Sign in with Trakt and your history comes with you."
          />
          <LegalLinks />
        </ScrollView>
      </Screen>
    );
  }

  const identity = auth.profile?.identities.find((i) => i.displayName) ?? auth.profile?.identities[0];
  const name = identity?.displayName ?? 'You';
  const handle = name.toLowerCase().replace(/\s+/g, '');
  const joined = auth.profile?.user.createdAt ? new Date(auth.profile.user.createdAt * 1000).getFullYear() : null;
  const avatar = auth.profile?.identities.find((i) => i.avatarUrl)?.avatarUrl ?? null;

  const entries = [
    { href: '/wishlist', label: 'Wishlist', hint: stats ? `${stats.wishlist} saved` : '', Icon: Bookmark },
    { href: '/wishlist?tab=library', label: 'Your ratings', hint: stats ? `${stats.rated} titles` : '', Icon: Star },
    { href: '/settings', label: 'Settings', hint: 'Account, sync, privacy', Icon: SettingsIcon },
  ];
  const recommended = rails.recommendation ? rails.withoutHidden(rails.recommendation).filter((c) => types.isVisible(c.type)).slice(0, 8) : [];

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.main}>
        <View style={styles.header}>
          <Avatar src={avatar} name={name} size={64} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text accessibilityRole="header" numberOfLines={1} style={type.serifXl}>{name}</Text>
            <Text style={[type.meta, { marginTop: 4 }]}>@{handle}{joined ? ` · joined ${joined}` : ''}</Text>
          </View>
          <Pressable onPress={() => router.push('/settings')} accessibilityRole="link" accessibilityLabel="Settings" hitSlop={2} style={styles.gear}>
            <SettingsIcon size={16} color={color.textSecondary} />
          </Pressable>
        </View>

        {stats ? (
          <View style={styles.stats}>
            {[{ n: stats.tracked, l: 'tracked' }, { n: stats.rated, l: 'rated' }, { n: stats.wishlist, l: 'wishlist' }].map(({ n, l }, i) => (
              <View key={l} style={[styles.stat, i > 0 && { borderLeftWidth: 1, borderLeftColor: color.border }]}>
                <Text style={type.serifLg}>{n}</Text>
                <Text style={[type.micro, { marginTop: 4, textTransform: 'none' }]}>{l}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View accessibilityLabel="Your pages" style={styles.entries}>
          {entries.map(({ href, label, hint, Icon }, i) => (
            <Pressable
              key={href}
              onPress={() => router.push(href as never)}
              accessibilityRole="link"
              style={({ pressed }) => [styles.entry, i > 0 && { borderTopWidth: 1, borderTopColor: color.border }, pressed && { backgroundColor: color.surfaceElevated }]}>
              <View style={styles.entryIcon}><Icon size={16} color={color.textSecondary} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={type.label}>{label}</Text>
                {hint ? <Text numberOfLines={1} style={[type.caption, { marginTop: 2 }]}>{hint}</Text> : null}
              </View>
              <ChevronRight size={16} color={color.textSecondary} />
            </Pressable>
          ))}
        </View>

        <Button label="Sign out" variant="secondary" size="lg" onPress={() => void auth.signOut()} />

        <TitleLines title="Recently added" seeAll="/wishlist?tab=library" lines={stats?.recent ?? []} />
        <TitleLines title="Coming up" seeAll="/calendar" lines={stats?.coming ?? []} />
        {recommended.length ? <CardRail title="Recommended for you" forYou seeAllHref="/discover" items={recommended} /> : null}

        <View style={styles.footer}><LegalLinks /></View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // max-w-2xl, px-6, py-8, space-y-7
  main: { width: '100%', maxWidth: 672, alignSelf: 'center', paddingHorizontal: 24, paddingVertical: 32, gap: 28 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  gear: {
    width: 40, height: 40, borderRadius: radius.xl, alignItems: 'center', justifyContent: 'center',
    backgroundColor: color.surfaceElevated, borderWidth: 1, borderColor: color.border,
  },
  stats: { flexDirection: 'row', alignItems: 'center', overflow: 'hidden', backgroundColor: color.surfaceElevated, borderWidth: 1, borderColor: color.border, borderRadius: radius.xl },
  stat: { flex: 1, alignItems: 'center', paddingVertical: 12, paddingHorizontal: 8 },
  entries: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: color.border },
  entry: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 4, marginHorizontal: -4 },
  entryIcon: {
    width: 36, height: 36, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center',
    backgroundColor: color.surfaceElevated, borderWidth: 1, borderColor: color.border,
  },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  line: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 8, minHeight: 36,
    backgroundColor: color.surfaceElevated, borderWidth: 1, borderColor: color.border, borderRadius: radius.lg,
  },
  dot: { width: 6, height: 6, borderRadius: radius.full },
  footer: { marginTop: 12, paddingTop: 24, borderTopWidth: 1, borderTopColor: color.border },
});
