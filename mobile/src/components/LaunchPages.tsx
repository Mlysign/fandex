// The website's launch pages: /app, /press, /whats-new and /delete-account.
//
// Laid out as /score is (src/app/(tabs)/score.tsx): one column of 672, an
// eyebrow and a serif heading, then short sections of a label and a line. The
// build renders them to static HTML (mobile/web/render.tsx), so everything here
// must render on a server: no router, no session, no database, no `window`.
// They are written as files and never start the app: a stranger reads them,
// and Google Play needs /delete-account to work without the app.
//
// The launch switch and the words that may change are in lib/launch.ts; the
// What's new entries are lib/whatsNew.ts.

import { ArrowLeft } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { backButtonStyle } from '~/components/FacetHeader';
import { Img } from '~/components/Img';
import { Button, Eyebrow } from '~/components/kit';
import { LegalLinks } from '~/components/LegalLinks';
import {
  CONTACT_EMAIL, hasPlayStore, MESSAGE_CALENDAR, MESSAGE_NUMBERS, MESSAGE_TASTE, PLAY_STORE_URL,
} from '~/lib/launch';
import { WHATS_NEW, type WhatsNewEntry } from '~/lib/whatsNew';
import { color, radius, type } from '~/theme';

/** A short clip for /app. None yet: the slot renders nothing until one is added here. */
export interface AppClip { src: string; caption: string; poster?: string }
export const APP_CLIPS: AppClip[] = [];

/** A file a press visitor can download, served from /press-kit/. */
export interface PressFile { href: string; label: string; preview?: string }

/** The icon files the build copies from public/ into /press-kit/ (mobile/web/build.mjs). */
export const PRESS_FILES: PressFile[] = [
  { href: '/press-kit/fandex-icon.svg', label: 'Icon, SVG', preview: '/press-kit/fandex-icon-512.png' },
  { href: '/press-kit/fandex-icon-512.png', label: 'Icon, PNG, 512 by 512' },
  { href: '/press-kit/fandex-icon-192.png', label: 'Icon, PNG, 192 by 192' },
  { href: '/press-kit/fandex-icon-maskable-512.png', label: 'Icon with safe margin, PNG, 512 by 512' },
  { href: '/press-kit/fandex-card-1200x630.png', label: 'Name and icon, PNG, 1200 by 630', preview: '/press-kit/fandex-card-1200x630.png' },
];

// react-native-web renders a Text or Pressable with `href` as an <a>, and
// `aria-level` on a header as <h2>. React Native's own types have neither.
const link = (href: string) => ({ href }) as object;
const H2 = { 'aria-level': 2 } as object;

function BackHome() {
  return (
    <Pressable {...link('/')} accessibilityRole="link" accessibilityLabel="Fandex, home" style={backButtonStyle}>
      <ArrowLeft size={16} color={color.textSecondary} />
    </Pressable>
  );
}

/** The page shell: /score's column, with a link home where /score has its back button. */
function Page({ eyebrow, title, lead, children }: { eyebrow: string; title: string; lead?: string; children: ReactNode }) {
  return (
    <ScrollView contentContainerStyle={styles.main}>
      <View>
        <BackHome />
        <Eyebrow>{eyebrow}</Eyebrow>
        <Text accessibilityRole="header" style={[type.serifXl, { marginTop: 4 }]}>{title}</Text>
        {lead ? <Text style={[type.body, styles.lead]}>{lead}</Text> : null}
      </View>
      {children}
      <LegalLinks />
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" {...H2} style={type.label}>{title}</Text>
      {children}
    </View>
  );
}

function Line({ children }: { children: ReactNode }) {
  return <Text style={[type.bodySm, styles.text]}>{children}</Text>;
}

function List({ items, numbered }: { items: string[]; numbered?: boolean }) {
  return (
    <View style={{ gap: 4 }}>
      {items.map((t, i) => (
        <View key={t} style={styles.bullet}>
          <Text style={[type.bodySm, styles.text, { minWidth: 10 }]}>{numbered ? `${i + 1}.` : '·'}</Text>
          <Text style={[type.bodySm, styles.text, { flex: 1 }]}>{t}</Text>
        </View>
      ))}
    </View>
  );
}

function A({ href, children }: { href: string; children: ReactNode }) {
  return <Text {...link(href)} accessibilityRole="link" style={styles.a}>{children}</Text>;
}

/** The Google Play link. Renders only when PLAY_STORE_URL is set (lib/launch.ts). */
export function PlayStoreBadge({ url = PLAY_STORE_URL }: { url?: string }) {
  if (!hasPlayStore(url)) return null;
  return <Button label="Get it on Google Play" variant="primary" size="md" href={url} style={{ alignSelf: 'flex-start' }} />;
}

// ── /app ─────────────────────────────────────────────────────────────────────

export function AppPage({ playStoreUrl = PLAY_STORE_URL, clips = APP_CLIPS }: { playStoreUrl?: string; clips?: AppClip[] }) {
  return (
    <Page eyebrow="Fandex" title="What Fandex is" lead="Fandex keeps your films, shows, games and books in one list. It is free, and there are no ads.">
      <Section title={MESSAGE_TASTE}>
        <Line>Fandex learns your taste from what you rate. It uses it across films, shows, games and books, and guesses what you would rate a title you have not tried yet.</Line>
      </Section>
      <Section title={MESSAGE_CALENDAR}>
        <Line>One calendar shows when your films, shows, games and books come out, in the dates for your country. The Android app can remind you on the day.</Line>
      </Section>
      <Section title={MESSAGE_NUMBERS}>
        <Line>See which tags, people and studios lift or lower your ratings. Every score has a &quot;Why?&quot; that shows what it is based on. Only your own ratings count.</Line>
      </Section>

      {clips.length ? (
        <View style={styles.clips}>
          {clips.map((c) => (
            <View key={c.src} style={styles.clip}>
              <video src={c.src} poster={c.poster} controls muted playsInline preload="none" style={{ width: '100%', borderRadius: radius.md, background: color.surfaceElevated }} />
              <Text style={[type.caption, styles.text]}>{c.caption}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <Section title="Get Fandex">
        {hasPlayStore(playStoreUrl) ? (
          <>
            <Line>Get the Android app on Google Play.</Line>
            <PlayStoreBadge url={playStoreUrl} />
          </>
        ) : (
          <Line>The Android app is coming to Google Play.</Line>
        )}
        <Line>You can also use Fandex in any browser, here at fandex.org.</Line>
      </Section>

      <Section title="On an iPhone?">
        <Line>There is no iPhone app yet. The website works on an iPhone.</Line>
        <Line>To keep it on your home screen, open fandex.org in Safari, tap Share, then tap Add to Home Screen.</Line>
        <Line>Release reminders are only in the Android app.</Line>
      </Section>

      <Button label="Open Fandex" variant="secondary" size="md" href="/" style={{ alignSelf: 'flex-start' }} />
    </Page>
  );
}

// ── /press ───────────────────────────────────────────────────────────────────

/** From docs/release-plan/drafts/facts-sheet.md: only the lines with no placeholder and no open doubt. */
const DOES = [
  'Keep a wishlist and a library of films, shows, games and books.',
  'Rate a title from 1 to 10.',
  'See release dates on a month calendar, in the dates for your country.',
  'Get a reminder at 09:00 on release day, on the day a new season starts or on the day the next episode airs. There are three switches in Settings.',
  'Tick off episodes as you watch. An "Up next" list and a home-screen widget show the next episode of each show.',
  'See a "Recommended for you" list on the home screen.',
  'See an estimated rating for each title, called the Fandex Score. It is a number that says what you would probably rate it, worked out from your own ratings.',
  'See statistics about your own taste on an Insights page.',
  'Sync with Trakt (films and shows).',
  'Import your ratings and watchlist from a Letterboxd or IMDb export file.',
  'Download your data.',
  "Read titles in the language of the country you set. The app's own menus and buttons are in English only.",
];
const SOURCES = [
  'Films and shows: The Movie Database (TMDB), for titles, artwork, descriptions, cast and crew. Where to watch comes from JustWatch, through TMDB.',
  'Games: IGDB. Steam supplies store tags. Wikidata supplies some game credits.',
  'Books: Open Library and Hardcover.',
  'Watch history for films and shows: Trakt, if you connect your Trakt account.',
  'Trailers: YouTube.',
];

export function PressPage({ screenshots = [] }: { screenshots?: string[] }) {
  return (
    <Page eyebrow="Fandex" title="Press" lead="Facts, pictures and a contact for anyone writing about Fandex.">
      <Section title="What Fandex is">
        <Line>Fandex is an app and a website that keep your films, shows, games and books in one list. It puts their release dates on one calendar and tells you on the day something comes out.</Line>
      </Section>
      <Section title="What it does">
        <List items={DOES} />
      </Section>
      <Section title="Where it runs">
        <List items={[
          'Android app: coming to Google Play.',
          'Website: fandex.org, in any browser.',
          'No iPhone app. The website works in an iPhone browser. Release reminders work only in the Android app, not on the website.',
        ]} />
      </Section>
      <Section title="Price">
        <Line>Free. There are no ads today.</Line>
      </Section>
      <Section title="Where the data comes from">
        <List items={SOURCES} />
        <Line>Fandex is not endorsed or certified by any of these providers.</Line>
      </Section>

      <Section title="Icon and logo">
        <View style={styles.files}>
          {PRESS_FILES.filter((f) => f.preview).map((f) => (
            <View key={f.href} style={styles.preview}>
              <Img uri={f.preview!} width={f.preview!.includes('1200x630') ? 240 : 96} alt={f.label}
                style={f.preview!.includes('1200x630') ? { width: 240, height: 126, borderRadius: radius.md } : { width: 96, height: 96, borderRadius: radius.lg }} />
            </View>
          ))}
        </View>
        <View style={{ gap: 2 }}>
          {PRESS_FILES.map((f) => <Text key={f.href} {...({ href: f.href, hrefAttrs: { download: true } } as object)} accessibilityRole="link" style={[type.bodySm, styles.a, styles.fileLink]}>{f.label}</Text>)}
        </View>
        <Line>Please show the icon as it is: no new colours, no stretching.</Line>
      </Section>

      {screenshots.length ? (
        <Section title="Screenshots">
          <View style={styles.files}>
            {screenshots.map((src) => (
              <Pressable key={src} {...link(src)} accessibilityRole="link" accessibilityLabel="Screenshot, full size">
                <Img uri={src} width={180} alt="A screenshot of Fandex" style={{ width: 180, height: 'auto', borderRadius: radius.md }} />
              </Pressable>
            ))}
          </View>
        </Section>
      ) : null}

      <Section title="Contact">
        <Line>Write to <A href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</A>.</Line>
      </Section>
    </Page>
  );
}

// ── /whats-new ───────────────────────────────────────────────────────────────

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const spokenDate = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

export function WhatsNewPage({ entries = WHATS_NEW }: { entries?: WhatsNewEntry[] }) {
  return (
    <Page eyebrow="Fandex" title="What's new" lead="What changed in the app, newest first.">
      {entries.map((e) => (
        <View key={e.version} style={styles.section}>
          <Text accessibilityRole="header" {...H2} style={type.label}>Version {e.version}</Text>
          <Text style={type.meta}>{spokenDate(e.date)}</Text>
          {e.lines.map((l) => <Line key={l}>{l}</Line>)}
        </View>
      ))}
    </Page>
  );
}

// ── /delete-account ──────────────────────────────────────────────────────────
//
// Google Play's account deletion page. What it says is what the code does:
// DELETE /v1/me erases every table with a `user_id` and the account row in one
// batch (worker/src/account.ts, deleteAccount), the device then signs out and
// clears its copy (AuthProvider deleteAccount), and the backups age out after
// 30 days (privacy policy, "Storage and retention"). Change one, change this.

export function DeleteAccountPage() {
  return (
    <Page eyebrow="Fandex" title="Delete your account" lead="You can delete your Fandex account yourself, in Settings. It takes a minute. It cannot be undone.">
      <Section title="How to do it">
        <List numbered items={[
          'Sign in to Fandex, at fandex.org or in the Android app.',
          'Open Settings.',
          'Under "Your data", press Delete.',
          'Type DELETE and press "Delete my account".',
        ]} />
        <Button label="Open Settings" variant="secondary" size="md" href="/settings" style={{ alignSelf: 'flex-start', marginTop: 6 }} />
        <Line>Want a copy first? In the same place, press Download. You get a file with everything Fandex holds about you.</Line>
      </Section>

      <Section title="What gets deleted">
        <Line>All of this is deleted at once, as soon as you confirm:</Line>
        <List items={[
          'Your account, and the ways you sign in to it (Trakt, Google or Discord).',
          'Your library, your wishlist, your ratings and your reviews.',
          'The episodes you ticked as watched.',
          'The titles you hid.',
          'The tags, people, studios and series you follow or avoid.',
          'Your settings, such as your country and the kinds of titles you track.',
          'The day you last used Fandex.',
          'The counts your phone sent about how close your scores were to your ratings.',
        ]} />
        <Line>The device you delete from is signed out and its copy of your lists is removed. Other devices are signed out the next time they connect.</Line>
      </Section>

      <Section title="What is kept">
        <List items={[
          'Backups. Backups made before you deleted your account can still hold your data for up to 30 days. After that it is gone from them too.',
          'Your accounts on Trakt and Steam. Fandex only deletes what Fandex stores. Your ratings and lists there stay as they are.',
          'Page view counts. They do not name anyone, so nothing in them is yours.',
          'The list of titles itself, which is shared by everyone and holds nothing about you.',
        ]} />
      </Section>

      <Section title="Can't sign in any more?">
        <Line>Write to <A href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</A>. You will be asked to show that the account is yours, and then it is deleted. A person answers.</Line>
        <Line>More detail is in the <A href="/legal/en/privacy">privacy policy</A>.</Line>
      </Section>
    </Page>
  );
}

const styles = StyleSheet.create({
  main: { width: '100%', maxWidth: 672, alignSelf: 'center', paddingHorizontal: 24, paddingVertical: 24, gap: 24 },
  lead: { marginTop: 12, color: color.textSecondary },
  section: { gap: 6 },
  text: { color: color.textSecondary },
  bullet: { flexDirection: 'row', gap: 8 },
  a: { color: color.accent, textDecorationLine: 'underline' },
  fileLink: { lineHeight: 32 },
  files: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  preview: { borderRadius: radius.lg, overflow: 'hidden' },
  clips: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  clip: { flexBasis: 200, flexGrow: 1, gap: 6 },
});
