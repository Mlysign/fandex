// One title, as everybody sees it. The old site's item page (src/components/
// item/ItemView.tsx and its sections), in its mobile anatomy: a full-bleed 3:4
// hero that is also the image gallery, the score pills, the synopsis, the
// facts, then trailer, cast, where to watch, tags and links.
//
// Nothing here knows who is looking. The app's item screen passes its personal
// blocks (your state, your Fandex Score, the rating row) in as `personal`; the
// website renders this same component to HTML for a visitor or a crawler and
// passes nothing. That is the plan's one-component rule (docs/app-plan.md, "The
// website"), so this file must stay free of anything only a device has: no
// database, no session, no router.
//
// Not carried over yet, and listed in docs/app-parity.md: the two related
// rails, the episode tracker, and the links from a tag, a person or a studio
// to its own page (the app has no such pages yet).

import { ArrowLeft, Globe, Share2 } from 'lucide-react-native';
import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, type GestureResponderEvent, type NativeScrollEvent, type NativeSyntheticEvent, type StyleProp, type ViewStyle } from 'react-native';
import { companyKey, personKey } from '@/lib/facets';
import { keyToSlug } from '@/lib/facetUrl';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { BrandGlyph, hasBrandMark } from '~/components/BrandGlyph';
import { ExtLink } from '~/components/ExtLink';
import { part, useItemPageCss } from '~/components/itemLayout';
import { Img } from '~/components/Img';
import { Trailer } from '~/components/Trailer';
import { T } from '~/components/ui';
import type { CommunityRating, ItemDetail } from '~/lib/api';
import { compactCount, longDate, todayIso } from '~/lib/dates';
import type { Taxonomy } from '~/lib/fandexScore';
import { ITEM_SCROLL_ID } from '~/lib/prerender';
import { tagGroups } from '~/lib/itemTags';
import { color, font, radius, space, TYPE_LABEL } from '~/theme';

/** The page gutter. The handoff's 20 px, wider than a list screen's 16. */
const GUTTER = space.xl;

const SOURCE_LABEL: Record<string, string> = {
  trakt: 'Trakt', tmdb: 'TMDB', igdb: 'IGDB', steam: 'Steam', rawg: 'RAWG', letterboxd: 'Letterboxd',
};

function runtime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function money(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

function offerLabel(offerType: string | null | undefined): string | null {
  switch (offerType) {
    case 'flatrate': return 'Stream · included';
    case 'free': return 'Stream · free';
    case 'ads': return 'Stream · free with ads';
    case 'rent': return 'Rent';
    case 'buy': return 'Buy';
    default: return null;
  }
}

// ── The hero ─────────────────────────────────────────────────────────────────

/** The bottom scrim: three stops, so the title reads over any artwork. */
function Scrim() {
  return (
    <Svg style={styles.scrim} viewBox="0 0 1 1" preserveAspectRatio="none">
      <Defs>
        <LinearGradient id="heroScrim" x1="0" y1="1" x2="0" y2="0">
          <Stop offset="0.06" stopColor={color.surface} stopOpacity="0.98" />
          <Stop offset="0.44" stopColor={color.surface} stopOpacity="0.55" />
          <Stop offset="1" stopColor={color.surface} stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="1" height="1" fill="url(#heroScrim)" />
    </Svg>
  );
}

function Hero({ images, title, kind, metaParts, topInset, onBack, backHref, onShare, onHeight }: {
  images: string[];
  title: string;
  kind: string;
  metaParts: string[];
  topInset: number;
  onBack?: () => void;
  backHref?: string;
  onShare?: () => void;
  /** How tall the hero came out, so the page knows when it has scrolled away. */
  onHeight?: (height: number) => void;
}) {
  // The pager needs the hero's size in pixels, which exists only after layout.
  // Until then (and on a server, always) the first image stands alone, so the
  // page's main picture is in the first paint and in the HTML.
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [active, setActive] = useState(0);
  const [failed, setFailed] = useState<ReadonlySet<number>>(new Set());
  const pager = useRef<ScrollView>(null);
  const paged = images.length > 1 && box.w > 0;

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    // Rounded, so the dot flips half way through a swipe and feels attached to the finger.
    const i = Math.round(e.nativeEvent.contentOffset.x / box.w);
    setActive((prev) => (prev === i ? prev : Math.max(0, Math.min(i, images.length - 1))));
  };
  const slide = (uri: string, i: number) =>
    failed.has(i) ? null : (
      <Img
        uri={uri}
        width={540}
        alt={i === 0 ? title : ''}
        priority={i === 0}
        style={styles.fill}
        // Tracked by index, not filtered out, so the dots do not renumber mid-swipe.
        onError={() => setFailed((s) => new Set(s).add(i))}
      />
    );

  return (
    <View
      {...part('hero')}
      style={styles.hero}
      onLayout={(e) => {
        setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });
        onHeight?.(e.nativeEvent.layout.height);
      }}>
      {!images.length ? null : paged ? (
        <ScrollView
          ref={pager}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={32}
          style={styles.fill}
          accessibilityLabel={`${title}, images`}>
          {images.map((uri, i) => (
            <View key={`${uri}-${i}`} style={{ width: box.w, height: box.h }} accessibilityLabel={`Image ${i + 1} of ${images.length}`}>
              {slide(uri, i)}
            </View>
          ))}
        </ScrollView>
      ) : (
        slide(images[0], 0)
      )}

      <View {...part('hero-scrim')} style={styles.scrimWrap}><Scrim /></View>

      {onBack || backHref || onShare ? (
        <View style={[styles.heroButtons, { top: space.md + topInset }]}>
          {onBack ? (
            <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back" hitSlop={8} style={styles.circle}>
              <ArrowLeft size={20} color={color.textPrimary} />
            </Pressable>
          ) : backHref ? (
            // The same button as a link, for a page with no script behind it.
            // react-native-web renders a view with an `href` as an <a>.
            <Pressable {...({ href: backHref } as object)} accessibilityRole="link" accessibilityLabel="Fandex, home" style={styles.circle}>
              <ArrowLeft size={20} color={color.textPrimary} />
            </Pressable>
          ) : <View />}
          {onShare ? (
            <Pressable onPress={onShare} accessibilityRole="button" accessibilityLabel="Share this title" hitSlop={8} style={styles.circle}>
              <Share2 size={16} color={color.textPrimary} />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* Everything over the artwork lets a swipe through, except the dots themselves. */}
      <View {...part('hero-text')} style={styles.heroText}>
        {paged ? (
          <View style={styles.dots}>
            {images.map((_, i) => (
              <Pressable
                key={i}
                onPress={() => pager.current?.scrollTo({ x: i * box.w, animated: true })}
                accessibilityRole="button"
                accessibilityLabel={`Show image ${i + 1} of ${images.length}`}
                hitSlop={{ top: 16, bottom: 16, left: 3, right: 3 }}
                style={[styles.dot, i === active && styles.dotOn]}
              />
            ))}
          </View>
        ) : null}
        {/* On a wide window the title sits beside the artwork, not on it (itemLayout.ts). */}
        <View {...part('hero-title')}>
          <View style={styles.typeRow}>
            <View style={[styles.typeDot, { backgroundColor: color.media[kind] ?? color.textMuted }]} />
            <T variant="eyebrow">{TYPE_LABEL[kind] ?? kind}</T>
          </View>
          <Text accessibilityRole="header" style={styles.title}>{title}</Text>
          {metaParts.length ? <T variant="meta" style={styles.heroMeta}>{metaParts.join(' · ')}</T> : null}
        </View>
      </View>
    </View>
  );
}

// ── Small parts ──────────────────────────────────────────────────────────────

function SectionHeading({ children }: { children: string }) {
  return <T variant="eyebrow" style={styles.sectionHeading}>{children}</T>;
}

/**
 * How a link to a tag, person or studio page is followed. The app's screen gives
 * a function that navigates in place. A static page gives nothing, and the link
 * is then a plain anchor: this file knows no router.
 */
const FacetNav = createContext<((href: string) => void) | undefined>(undefined);

/** A link to a tag, a person or a studio. A real anchor in a browser. */
function FacetLink({ href, label, style, children }: { href: string; label?: string; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const open = useContext(FacetNav);
  // react-native-web renders a pressable with an `href` as an <a>.
  const anchor = Platform.OS === 'web' ? ({ href } as object) : null;
  return (
    <Pressable
      {...anchor}
      onPress={open ? (e?: GestureResponderEvent) => {
        (e as unknown as { preventDefault?: () => void } | undefined)?.preventDefault?.();
        open(href);
      } : undefined}
      accessibilityRole="link"
      accessibilityLabel={label}
      style={({ pressed }) => [style, pressed && { opacity: 0.6 }]}>
      {children}
    </Pressable>
  );
}

/** One row of the facts table. `linkTo` makes each name in the value a link to its own page. */
function Fact({ label, value, linkTo }: { label: string; value: string | null | undefined; linkTo?: 'person' | 'studio' }) {
  if (!value) return null;
  const names = linkTo ? value.split(', ').filter(Boolean) : [];
  return (
    <View style={styles.fact}>
      <T variant="caption">{label}</T>
      {linkTo ? (
        <View style={styles.factLinks}>
          {names.map((name) => {
            const key = linkTo === 'person' ? personKey(name) : companyKey(name);
            const tint = linkTo === 'person' ? color.facet.person : color.facet.company;
            return key ? (
              <FacetLink key={name} href={`/${linkTo}/${keyToSlug(key)}`}>
                <T variant="body" style={[styles.factValue, { color: tint }]}>{name}</T>
              </FacetLink>
            ) : <T key={name} variant="body" style={styles.factValue}>{name}</T>;
          })}
        </View>
      ) : <T variant="body" style={styles.factValue}>{value}</T>}
    </View>
  );
}

function scoreText(r: CommunityRating): string {
  if (r.outOf === 100) return `${Math.round(r.score)}${r.source === 'rt' || r.source === 'steam' ? '%' : ''}`;
  if (r.outOf === 5) return `${r.score.toFixed(1)}/5`;
  return r.score % 1 === 0 ? String(r.score) : r.score.toFixed(1);
}

function ScorePill({ label, value, href, hint }: { label: string; value: string; href?: string | null; hint?: string }) {
  const inner = (
    <>
      <Text style={styles.pillLabel}>{label}</Text>
      <Text style={styles.pillValue}>{value}</Text>
    </>
  );
  return href
    ? <ExtLink href={href} label={hint} style={styles.pill}>{inner}</ExtLink>
    : <View style={styles.pill} accessibilityLabel={hint}>{inner}</View>;
}

// ── The page ─────────────────────────────────────────────────────────────────

export function ItemPage({ item, personal, progress, footer, taxonomy = null, topInset = 0, bottomInset = 0, onBack, backHref, onShare, onOpenFacet }: {
  item: ItemDetail;
  /** Rendered between the score pills and the synopsis. */
  personal?: ReactNode;
  /** A show's episode tracker. Full width, above the sections, where the site had it. */
  progress?: ReactNode;
  /** Rendered after the last line of the page. The website's legal links. */
  footer?: ReactNode;
  /** Follow a link to a tag, person or studio page without a page load. Left out on a static page, where the links are anchors. */
  onOpenFacet?: (href: string) => void;
  /** Tag categories, bundles and chosen names. Without it the tags still group, by the built-in rules. */
  taxonomy?: Taxonomy | null;
  /** The status bar's height, on a device whose hero runs under it. */
  topInset?: number;
  /** What the last line has to clear, on a device that draws under its navigation buttons. */
  bottomInset?: number;
  /** The hero's two buttons. A page with no history to go back to passes neither. */
  onBack?: () => void;
  /** Where the back button leads on a static page, which has no handler to call. */
  backHref?: string;
  onShare?: () => void;
}) {
  useItemPageCss();
  const m = item.merged;
  const images = [m.posterUrl, ...m.images].filter((u, i, all): u is string => !!u && all.indexOf(u) === i);

  const credit = m.director ? `${item.type === 'show' ? 'by' : 'dir.'} ${m.director}` : null;
  const metaParts = [
    m.releaseDate ? m.releaseDate.slice(0, 4) : 'TBA',
    m.runtimeMinutes ? runtime(m.runtimeMinutes) : null,
    credit,
  ].filter((p): p is string => !!p);

  const released = longDate(m.releaseDate);
  const upcoming = !!m.releaseDate && m.releaseDate.slice(0, 10) > todayIso();
  const watchable = item.type === 'movie' || item.type === 'show';
  const groups = tagGroups(m.tags, m.keywords ?? [], taxonomy);
  const gameModes = m.gameModes ?? [];
  const dlc = m.dlc ?? [];
  const offer = offerLabel(m.streamingOfferType);
  const sources = [...new Set(m.dates.map((d) => d.source))];

  // The hero runs under the status bar on purpose. Once it has scrolled away the
  // page's text would run under the clock too (seen on the phone, 2026-10-05), so
  // from that point the bar gets the page's own colour behind it.
  const [heroHeight, setHeroHeight] = useState(0);
  const [pastHero, setPastHero] = useState(false);
  const onPageScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = heroHeight > 0 && e.nativeEvent.contentOffset.y > heroHeight - topInset;
    setPastHero((prev) => (prev === next ? prev : next));
  };

  return (
    <FacetNav.Provider value={onOpenFacet}>
    <View style={styles.page}>
    <ScrollView
      // How the app finds this element in a static page it takes over from (lib/prerender.ts).
      testID={ITEM_SCROLL_ID}
      contentContainerStyle={{ paddingBottom: space.section + bottomInset }}
      onScroll={topInset > 0 ? onPageScroll : undefined}
      scrollEventThrottle={32}>
      <View {...part('grid')}>
      <Hero
        images={images} title={m.title} kind={item.type} metaParts={metaParts}
        topInset={topInset} onBack={onBack} backHref={backHref} onShare={onShare} onHeight={setHeroHeight}
      />

      <View {...part('upper')} style={styles.body}>
        {/* The wide window's title block. Hidden until 1024 px by itemLayout.ts's rules. */}
        <View {...part('title-wide')} style={styles.titleWide}>
          <View style={[styles.typeRow, { marginBottom: 0 }]}>
            <View style={[styles.typeDot, { backgroundColor: color.media[item.type] ?? color.textMuted }]} />
            <T variant="eyebrow">{TYPE_LABEL[item.type] ?? item.type}</T>
          </View>
          <Text accessibilityRole="header" style={styles.title}>{m.title}</Text>
          {metaParts.length ? <T variant="meta">{metaParts.join(' · ')}</T> : null}
        </View>

        {/* The release date, said in full. The hero's line only has room for the year. */}
        {released ? (
          <T variant="caption" style={upcoming ? { color: color.accent } : undefined}>
            {upcoming ? `Out ${released}` : `Released ${released}`}
            {item.region !== 'US' && item.type === 'movie' ? ` (${item.region})` : ''}
          </T>
        ) : null}

        {/* Per-source dates, only when the sources disagree: otherwise it is the line above, repeated. */}
        {new Set(m.dates.map((d) => d.date)).size > 1 ? (
          <View style={styles.dateBlock}>
            {m.dates.map((d) => (
              <View key={d.source} style={styles.dateRow}>
                <BrandGlyph source={d.source} size={12} />
                <T variant="caption" style={styles.dateSource}>{SOURCE_LABEL[d.source] ?? d.source}</T>
                <T variant="meta" style={{ color: color.textPrimary }}>{longDate(d.date)}</T>
              </View>
            ))}
          </View>
        ) : null}

        {m.communityRatings.length || m.steamReviewLabel ? (
          <View style={styles.pills}>
            {m.communityRatings.map((r) => (
              <ScorePill
                key={r.source}
                label={r.label}
                value={scoreText(r)}
                href={r.url}
                hint={`${r.label} ${scoreText(r)}${r.votes ? `, ${compactCount(r.votes)} votes` : ''}`}
              />
            ))}
            {m.steamReviewLabel ? <ScorePill label="Steam" value={m.steamReviewLabel} /> : null}
          </View>
        ) : null}

        {personal}

        {m.tagline ? <Text {...part('prose')} style={styles.tagline}>{m.tagline}</Text> : null}
        {m.description ? <Text {...part('prose')} style={styles.description}>{m.description}</Text> : null}

        <View>
          <Fact label={item.type === 'show' ? 'Creator' : 'Director'} value={m.director} linkTo="person" />
          <Fact label="Developer" value={m.developer} linkTo="studio" />
          <Fact label="Publisher" value={m.publisher && m.publisher !== m.developer ? m.publisher : null} linkTo="studio" />
          <Fact label="Network" value={m.network} linkTo="studio" />
          <Fact label="Rated" value={m.certification.length ? m.certification.join(' · ') : null} />
          <Fact label="Runtime" value={m.runtimeMinutes ? `${runtime(m.runtimeMinutes)}${item.type === 'show' ? '/ep' : ''}` : null} />
          <Fact label="Status" value={m.status} />
          <Fact
            label="Episodes"
            value={item.type === 'show' && (m.seasonCount || m.episodeCount)
              ? [m.seasonCount ? `${m.seasonCount} season${m.seasonCount > 1 ? 's' : ''}` : null, m.episodeCount ? `${m.episodeCount} eps` : null].filter(Boolean).join(' · ')
              : null}
          />
          <Fact
            label="Next episode"
            value={m.nextEpisode?.airDate
              ? `${m.nextEpisode.season != null && m.nextEpisode.episode != null ? `S${m.nextEpisode.season}E${m.nextEpisode.episode} · ` : ''}${longDate(m.nextEpisode.airDate)}`
              : null}
          />
          <Fact label={item.type === 'game' ? 'Franchise' : 'Collection'} value={m.collection} />
          <Fact label="Language" value={m.originalLanguage} />
          <Fact label="Country" value={m.country} />
          <Fact label="Avg playtime" value={m.playtimeHours ? `${m.playtimeHours}h` : null} />
          <Fact label="Time to beat" value={m.timeToBeat?.normally != null ? `${m.timeToBeat.normally}h` : null} />
          <Fact label="Budget" value={m.budget ? money(m.budget) : null} />
          <Fact label="Box office" value={m.revenue ? money(m.revenue) : null} />
        </View>
      </View>

      <View {...part('lower')} style={styles.lower}>
        {progress}
        {m.trailerYoutubeKey ? (
          <View>
            <SectionHeading>Trailer</SectionHeading>
            <Trailer youtubeKey={m.trailerYoutubeKey} title={m.title} />
          </View>
        ) : m.steamTrailerUrl ? (
          <ExtLink href={m.steamTrailerUrl} style={styles.steamTrailer}>
            <BrandGlyph source="steam" size={18} tint={color.textPrimary} />
            <T variant="body">Watch trailer on Steam →</T>
          </ExtLink>
        ) : null}

        {watchable && m.cast?.length ? (
          <View>
            <SectionHeading>Cast</SectionHeading>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.castStrip}>
              {m.cast.map((c, i) => (
                <FacetLink key={`${c.name}-${i}`} href={`/person/${keyToSlug(personKey(c.name))}`} label={c.character ? `${c.name} as ${c.character}` : c.name} style={styles.castCard}>
                  <View style={styles.castPortrait}>
                    {c.profileUrl
                      ? <Img uri={c.profileUrl} width={64} alt={c.name} style={styles.fill} />
                      : <Text style={styles.castInitial}>{c.name?.[0] ?? '?'}</Text>}
                  </View>
                  <T variant="label" numberOfLines={2} style={styles.castName}>{c.name}</T>
                  {c.character ? <Text numberOfLines={1} style={styles.castRole}>{c.character}</Text> : null}
                </FacetLink>
              ))}
            </ScrollView>
          </View>
        ) : null}

        {/* Always there for a film or a show: a missing section could not be told
            from a title nobody checked. A game's places to go are its Links. */}
        {watchable ? (
          <View>
            <SectionHeading>Where to watch</SectionHeading>
            {m.streamingProviders.length ? (
              <>
                {m.streamingProviders.map((p) => {
                  const row = (
                    <>
                      <View style={styles.providerLogo}>
                        {p.logoPath
                          ? <Img uri={`https://image.tmdb.org/t/p/w92${p.logoPath}`} width={46} alt="" style={styles.fill} />
                          : <T variant="meta">{p.name.slice(0, 3).toUpperCase()}</T>}
                      </View>
                      <View style={styles.providerBody}>
                        <T variant="title" numberOfLines={1}>{p.name}</T>
                        {offer ? <T variant="meta">{offer}</T> : null}
                      </View>
                    </>
                  );
                  return m.streamingLink
                    ? <ExtLink key={p.providerId} href={m.streamingLink} label={`${p.name}: where to watch ${m.title}`} style={styles.providerRow}>{row}</ExtLink>
                    : <View key={p.providerId} style={styles.providerRow}>{row}</View>;
                })}
                {/* Required: TMDB's watch-provider terms name JustWatch as the source. */}
                <ExtLink href="https://www.justwatch.com" style={styles.attribution}>
                  <T variant="meta">Streaming availability data by JustWatch</T>
                </ExtLink>
              </>
            ) : (
              <T variant="body" style={{ color: color.textSecondary }}>
                {upcoming
                  ? "Not streaming anywhere yet. This hasn't been released."
                  : 'Not available on any streaming service in your region right now.'}
              </T>
            )}
          </View>
        ) : null}

        {dlc.length ? (
          <View>
            <SectionHeading>DLC &amp; expansions</SectionHeading>
            <View style={styles.chips}>
              {dlc.map((d) => (
                <View key={d} style={[styles.chip, { backgroundColor: color.surfaceElevated }]}>
                  <Text style={[styles.chipText, { color: color.textSecondary }]}>{d}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {groups.length || m.platforms.length || gameModes.length ? (
          <View>
            <SectionHeading>Tags &amp; details</SectionHeading>
            <View style={styles.tagGroups}>
              {groups.map((g) => {
                const tint = g.id === 'genre' ? color.facet.genre : color.facet.tag;
                return (
                  <View key={g.id} style={styles.chips}>
                    <Text style={styles.groupLabel}>{g.label}</Text>
                    {g.items.map((it) => (
                      <FacetLink key={it.key} href={`/tag/${keyToSlug(it.key)}`} style={[styles.chip, { backgroundColor: `${tint}21` }]}>
                        <Text style={[styles.chipText, { color: tint }]}>{it.label}</Text>
                      </FacetLink>
                    ))}
                  </View>
                );
              })}
              {[['Platforms', m.platforms], ['Modes & perspective', gameModes]].map(([label, list]) =>
                (list as string[]).length ? (
                  <View key={label as string} style={styles.chips}>
                    <Text style={styles.groupLabel}>{label as string}</Text>
                    {(list as string[]).map((it) => (
                      <View key={it} style={[styles.chip, { backgroundColor: `${color.textSecondary}1F` }]}>
                        <Text style={[styles.chipText, { color: color.textSecondary }]}>{it}</Text>
                      </View>
                    ))}
                  </View>
                ) : null,
              )}
            </View>
          </View>
        ) : null}

        {m.storeLinks.length ? (
          <View style={styles.linksSection}>
            <SectionHeading>Links</SectionHeading>
            <View style={styles.links}>
              {m.storeLinks.map((l) => (
                <ExtLink key={`${l.name}:${l.url}`} href={l.url} label={l.name} sponsored={l.affiliate} style={styles.link}>
                  {/* A logo where we hold one, at a size it can be read at. The name otherwise. */}
                  {hasBrandMark(l.name)
                    ? <BrandGlyph source={l.name} size={22} />
                    : <><Globe size={18} color={color.textSecondary} /><T variant="body" style={{ color: color.textSecondary }}>{l.name}</T></>}
                </ExtLink>
              ))}
            </View>
          </View>
        ) : null}

        <T variant="meta" style={{ color: color.textMuted }}>
          Data from {(sources.length ? sources : item.vector.sources.map((s) => s.source)).map((s) => SOURCE_LABEL[s] ?? s.toUpperCase()).join(', ')}
        </T>

        {footer}
      </View>
      </View>
    </ScrollView>
    {topInset > 0 && pastHero ? <View style={[styles.statusBarCover, { height: topInset }]} /> : null}
    </View>
    </FacetNav.Provider>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  statusBarCover: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: color.surface },
  fill: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },

  // Full-bleed 3:4, capped so a wide window does not get a poster taller than itself.
  hero: { width: '100%', aspectRatio: 3 / 4, maxHeight: 640, backgroundColor: '#2A2521', overflow: 'hidden' },
  scrim: { position: 'absolute', left: 0, bottom: 0, width: '100%', height: '67%', pointerEvents: 'none' },
  scrimWrap: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' },
  // Shown from 1024 px only, by CSS. On a phone and on a server it does not exist.
  titleWide: { display: 'none', gap: 10 },
  heroButtons: {
    position: 'absolute', left: space.lg, right: space.lg,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  circle: {
    width: 36, height: 36, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(11,10,8,0.55)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  heroText: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: GUTTER, paddingBottom: GUTTER, pointerEvents: 'box-none' },
  dots: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginBottom: space.md },
  dot: { width: 6, height: 6, borderRadius: radius.full, backgroundColor: 'rgba(237,231,220,0.4)' },
  dotOn: { width: 20, backgroundColor: color.textPrimary },
  typeRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginBottom: 10, pointerEvents: 'none' },
  typeDot: { width: 6, height: 6, borderRadius: radius.full },
  title: { fontFamily: font.serif, fontSize: 34, lineHeight: 35, color: color.textPrimary, pointerEvents: 'none' },
  heroMeta: { color: '#C3B8A8', marginTop: space.sm, pointerEvents: 'none' },

  // One vertical rhythm for everything under the hero: 24 between blocks.
  body: { paddingHorizontal: GUTTER, paddingTop: space.xl, gap: space.xxl },
  // The band below, with more air: 32 between sections.
  lower: { paddingHorizontal: GUTTER, marginTop: 40, gap: 32 },

  dateBlock: { gap: space.xs, marginTop: -space.md },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dateSource: { width: 72 },

  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: 10, paddingVertical: space.xs,
    borderRadius: radius.lg, backgroundColor: color.surfaceElevated, borderWidth: 1, borderColor: color.border,
  },
  pillLabel: { fontFamily: font.sansBold, fontSize: 10, letterSpacing: 0.4, textTransform: 'uppercase', color: color.textSecondary },
  pillValue: { fontFamily: font.sansBold, fontSize: 14, color: color.textPrimary },

  tagline: { fontFamily: font.sans, fontStyle: 'italic', fontSize: 16, lineHeight: 23, color: color.textSecondary },
  description: { fontFamily: font.sans, fontSize: 14, lineHeight: 23, color: color.textSecondary },

  factLinks: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', columnGap: 10 },
  fact: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.lg,
    paddingVertical: 10, borderTopWidth: 1, borderTopColor: color.border,
  },
  factValue: { flexShrink: 1, textAlign: 'right', fontSize: 13, lineHeight: 19 },

  sectionHeading: { color: color.accent, marginBottom: space.md },
  steamTrailer: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, alignSelf: 'flex-start',
    paddingHorizontal: space.lg, paddingVertical: space.sm,
    borderRadius: radius.lg, backgroundColor: color.surfaceElevated, borderWidth: 1, borderColor: color.border,
  },

  castStrip: { gap: space.md, paddingBottom: space.sm },
  castCard: { width: 74, alignItems: 'center' },
  castPortrait: {
    width: 64, height: 64, borderRadius: radius.full, overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
    backgroundColor: color.surfaceElevated, borderWidth: 1, borderColor: color.border,
  },
  castInitial: { fontFamily: font.sansBold, fontSize: 18, color: color.textMuted },
  castName: { marginTop: space.sm, textAlign: 'center', lineHeight: 15 },
  castRole: { fontFamily: font.sans, fontSize: 10, lineHeight: 14, color: color.textSecondary, textAlign: 'center' },

  providerRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingVertical: 10, borderTopWidth: 1, borderTopColor: color.border,
  },
  providerLogo: {
    width: 36, height: 36, borderRadius: radius.sm, overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
    backgroundColor: color.surfaceElevated, borderWidth: 1, borderColor: color.border,
  },
  providerBody: { flex: 1, minWidth: 0, gap: space.xxs },
  attribution: { marginTop: space.sm, alignSelf: 'flex-start' },

  tagGroups: { gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.xs },
  groupLabel: { fontFamily: font.sans, fontSize: 10, letterSpacing: 0.4, textTransform: 'uppercase', color: color.textSecondary, marginRight: space.xxs },
  chip: { paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.full },
  chipText: { fontFamily: font.sans, fontSize: 12, lineHeight: 16 },

  linksSection: { paddingTop: space.sm, borderTopWidth: 1, borderTopColor: color.border },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  link: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, height: 44, paddingHorizontal: space.md,
    borderRadius: radius.lg,
  },
});
