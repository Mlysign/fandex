// The calendar. Port of src/components/CalendarView.tsx and ui/ScopeFilter.tsx:
// a month grid that fits the screen without scrolling, a day's titles in a rail
// under the grid when the day is tapped (the grid folds to the week it is in),
// three sources to switch on and off (your wishlist, your library, what is
// popular), and a list view of what is still to come.
//
// The month never changes size while you use it: the cells are given their
// height from the space measured, and the rail takes its room from the weeks
// that fold away. Not carried over: the slide between months.

import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Bookmark, CalendarDays, CalendarX, Check, ChevronLeft, ChevronRight, Flame, Library, List, Star, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { ActionBar, PosterCard, Rail, useCardKit } from '~/components/cards';
import { Img } from '~/components/Img';
import { EmptyState } from '~/components/kit';
import { TypeIcon } from '~/components/Logo';
import { SubBar } from '~/components/SubBar';
import { Screen } from '~/components/ui';
import { api } from '~/lib/api';
import { useAuth } from '~/lib/AuthProvider';
import { cardFromCatalog, cardHref, type CardItem, type CardState } from '~/lib/cards';
import { useCatalogSync } from '~/lib/CatalogSyncProvider';
import { currentMonth, monthLabel, shiftMonth, todayIso } from '~/lib/dates';
import type { CatalogRow } from '~/lib/db';
import { lookupHeld, toCard } from '~/lib/homeFeed';
import { deviceRegion } from '~/lib/region';
import { useTypeFilter } from '~/lib/typeFilter';
import { breakpoint, color, font, radius, type } from '~/theme';

type Scope = 'wishlist' | 'library' | 'popular';
const SCOPES: { key: Scope; label: string; Icon: typeof Flame }[] = [
  { key: 'wishlist', label: 'Wishlist releases', Icon: Bookmark },
  { key: 'library', label: 'Library releases', Icon: Library },
  { key: 'popular', label: 'Popular releases', Icon: Flame },
];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MAX_MONTHS_AWAY = 24;
const RAIL_OPEN_PX = 400;
const RAIL_GAP_PX = 12;

const pad2 = (n: number) => String(n).padStart(2, '0');
/** "Saturday, October 10" for a YYYY-MM-DD. */
function longDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

// ── The source circles ───────────────────────────────────────────────────────

function ScopeFilter({ active, onToggle, signedIn, onSignIn }: { active: Scope[]; onToggle: (s: Scope) => void; signedIn: boolean; onSignIn: () => void }) {
  const { width } = useWindowDimensions();
  const roomy = width >= breakpoint.lg;
  const [open, setOpen] = useState(false);
  const selected = SCOPES.filter((s) => active.includes(s.key));
  const all = selected.length === SCOPES.length;

  if (!open && !roomy) {
    const Icon = selected.length === 1 ? selected[0].Icon : Flame;
    return (
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={selected.length ? `Filter by source (${selected.map((s) => s.label).join(', ')})` : 'Filter by source, nothing selected'}
        hitSlop={2}
        style={[styles.circle, !all && { borderColor: color.accent }]}>
        <Icon size={16} color={all ? color.textSecondary : color.accent} />
        {!all && selected.length > 1 ? <View style={styles.count}><Text style={styles.countText}>{selected.length}</Text></View> : null}
      </Pressable>
    );
  }
  return (
    <View style={styles.circles} accessibilityLabel="Filter by source">
      {SCOPES.map(({ key, label, Icon }) => {
        // Your lists need an account. The circle stays, dimmed, and leads to sign-in.
        const locked = !signedIn && key !== 'popular';
        const on = !locked && active.includes(key);
        return (
          <Pressable
            key={key}
            onPress={() => (locked ? onSignIn() : onToggle(key))}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={locked ? `${label}, sign in to use` : label}
            hitSlop={2}
            style={[styles.circle, on && { backgroundColor: color.accent, borderColor: color.accent }, locked && { opacity: 0.45 }]}>
            <Icon size={16} color={on ? color.textOnAccent : color.textSecondary} />
          </Pressable>
        );
      })}
    </View>
  );
}

// ── A day's cell ─────────────────────────────────────────────────────────────

function ItemMeta({ item, state }: { item: CardItem; state: CardState }) {
  return (
    <View style={styles.meta}>
      <TypeIcon type={item.type} size={11} tint={color.media[item.type] ?? '#888'} />
      {state.rating ? (
        <View style={styles.metaRating}>
          <Star size={10} color={color.accent} fill={color.accent} />
          <Text style={styles.metaRatingText}>{state.rating % 1 === 0 ? state.rating.toFixed(0) : state.rating.toFixed(1)}</Text>
        </View>
      ) : null}
      {state.inLibrary ? <Check size={10} color={color.success} /> : null}
      {state.wishlisted ? <Bookmark size={10} color={color.accent} fill={color.accent} /> : null}
    </View>
  );
}

function Cell({ day, date, items, stateOf, today, selected, desktop, onOpen }: {
  day: number; date: string; items: CardItem[]; stateOf: (id: string | null) => CardState;
  today: boolean; selected: boolean; desktop: boolean; onOpen: (date: string) => void;
}) {
  const single = items.length === 1 ? items[0] : null;
  const visible = desktop ? 3 : 2;
  const label = `${longDay(date)}, ${items.length === 0 ? 'no releases' : single ? `1 release: ${single.title}` : `${items.length} releases`}`;
  return (
    <Pressable
      onPress={() => onOpen(date)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded: selected }}
      style={[
        styles.cell, { borderRadius: desktop ? radius.md : radius.sm },
        single ? { borderColor: `${color.media[single.type] ?? '#888888'}44` }
          : items.length ? { borderColor: color.borderStrong, backgroundColor: 'rgba(24,21,18,0.4)' }
          : { borderColor: 'rgba(237,231,220,0.055)' },
        (today || selected) && { borderColor: color.accent, borderWidth: 2 },
      ]}>
      {single?.posterUrl ? (
        <>
          <Img uri={single.posterUrl} width={120} alt="" style={[styles.fill, { opacity: 0.4 }]} />
          <Svg style={styles.fill} viewBox="0 0 1 1" preserveAspectRatio="none">
            <Defs>
              <LinearGradient id={`cell-${date}`} x1="0" y1="1" x2="0" y2="0">
                <Stop offset="0" stopColor={color.surfaceInset} stopOpacity="0.9" />
                <Stop offset="0.5" stopColor={color.surfaceInset} stopOpacity="0.3" />
                <Stop offset="1" stopColor={color.surfaceInset} stopOpacity="0" />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="1" height="1" fill={`url(#cell-${date})`} />
          </Svg>
        </>
      ) : null}
      <View style={[styles.cellBody, { padding: desktop ? 8 : 4 - (today || selected ? 1 : 0) }]}>
        {today ? (
          <View style={[styles.todayDot, desktop && { width: 20, height: 20 }]}><Text style={styles.todayText}>{day}</Text></View>
        ) : <Text style={type.meta}>{day}</Text>}
        {single ? (
          <View style={{ flex: 1, justifyContent: 'flex-end', gap: 2 }}>
            <Text numberOfLines={2} style={[styles.cellTitle, desktop && { fontSize: 13, lineHeight: 16 }]}>{single.title}</Text>
            <ItemMeta item={single} state={stateOf(single.id)} />
          </View>
        ) : items.length ? (
          <View style={{ flex: 1, gap: 2, overflow: 'hidden', marginTop: 2 }}>
            {items.slice(0, visible).map((it) => (
              <View key={it.key} style={styles.cellRow}>
                <ItemMeta item={it} state={stateOf(it.id)} />
                <Text numberOfLines={1} style={styles.cellRowText}>{it.title}</Text>
              </View>
            ))}
            {items.length > visible ? <Text style={[styles.cellRowText, { marginTop: 'auto' }]}>+{items.length - visible} more</Text> : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

// ── The screen ───────────────────────────────────────────────────────────────

export default function CalendarScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const auth = useAuth();
  const catalog = useCatalogSync();
  const types = useTypeFilter();
  const region = useMemo(deviceRegion, []);
  const { width } = useWindowDimensions();
  const desktop = width >= breakpoint.md;
  const signedIn = auth.status === 'signedIn';

  const [month, setMonth] = useState(currentMonth);
  const [mode, setMode] = useState<'month' | 'agenda'>('month');
  const [scopes, setScopes] = useState<Scope[]>(['wishlist', 'library', 'popular']);
  const [selected, setSelected] = useState<string | null>(null);
  /** The rail keeps showing the last day while it closes, so it does not empty on the way out. */
  const [railDay, setRailDay] = useState<string | null>(null);
  useEffect(() => setSelected(null), [month]);
  useEffect(() => { if (selected) setRailDay(selected); }, [selected]);

  // What is popular this month, from the Worker.
  const [popular, setPopular] = useState<CardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const wanted = useRef(month);
  useEffect(() => {
    wanted.current = month;
    setLoading(true);
    setNote(null);
    (async () => {
      try {
        const res = await api.calendar(month, region);
        const cards = res.data.items.filter((c) => c.releaseDate?.startsWith(month));
        const held = await lookupHeld(cards);
        if (wanted.current !== month) return;
        setPopular(cards.map((c) => toCard(c, held)));
        if (res.data.partial) setNote('One of the databases did not answer, so this month may be missing titles.');
      } catch {
        if (wanted.current !== month) return;
        setPopular([]);
        setNote('The release feed is not answering. Your own lists are still here.');
      } finally {
        if (wanted.current === month) setLoading(false);
      }
    })();
  }, [month, region]);

  // What of yours comes out this month, from the device.
  const [mine, setMine] = useState<{ card: CardItem; relation: string }[]>([]);
  useEffect(() => {
    let live = true;
    if (!signedIn) { setMine([]); return; }
    void db.getAllAsync<CatalogRow & { relation: string }>(
      `SELECT DISTINCT c.id, c.type, c.title, c.slug, c.poster_url, c.release_date, c.year, c.community_score, c.community_votes, s.relation
         FROM item_state s JOIN catalog c ON c.id = s.media_item_id
        WHERE s.relation IN ('wishlist', 'library') AND c.release_date LIKE ?`,
      [`${month}%`],
    ).then((rows) => { if (live) setMine(rows.map((r) => ({ card: cardFromCatalog(r), relation: r.relation }))); });
    return () => { live = false; };
  }, [db, month, signedIn, auth.rowsRevision, catalog.revision]);

  const items = useMemo(() => {
    const out = new Map<string, CardItem>();
    for (const m of mine) if (scopes.includes(m.relation as Scope)) out.set(m.card.id as string, m.card);
    // A popular title you also hold is one title, and yours is the fuller card.
    if (scopes.includes('popular')) for (const p of popular) if (!(p.id && out.has(p.id))) out.set(p.id ?? p.key, p);
    return [...out.values()].filter((i) => types.isVisible(i.type));
  }, [mine, popular, scopes, types]);
  const kit = useCardKit(items);

  const byDay = useMemo(() => {
    const groups = new Map<string, CardItem[]>();
    for (const it of items) {
      const d = it.releaseDate?.slice(0, 10);
      if (!d) continue;
      const list = groups.get(d);
      if (list) list.push(it); else groups.set(d, [it]);
    }
    return groups;
  }, [items]);

  // ── The month's shape ──
  const [y, m] = month.split('-').map(Number);
  const dayCount = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const startPad = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const weekCount = Math.max(1, Math.ceil((startPad + dayCount) / 7));
  const today = todayIso();
  const here = currentMonth();
  const away = (y - Number(here.slice(0, 4))) * 12 + (m - Number(here.slice(5)));
  const monthItemCount = items.filter((i) => i.releaseDate?.startsWith(month)).length;

  // ── The height budget: the grid's box is measured, and everything in it is given pixels ──
  const [boxH, setBoxH] = useState(0);
  const onBox = (e: LayoutChangeEvent) => setBoxH(Math.round(e.nativeEvent.layout.height));
  const gap = desktop ? 6 : 2;
  const measured = boxH > 0;
  const rowH = measured ? Math.max(44, (boxH - (weekCount - 1) * gap) / weekCount) : desktop ? 128 : 80;
  const weeksOpen = measured ? Math.min(weekCount, Math.max(1, Math.floor((boxH - RAIL_OPEN_PX - RAIL_GAP_PX + gap) / (rowH + gap)))) : 1;
  const weeksShown = selected ? weeksOpen : weekCount;
  const selectedWeek = selected ? Math.floor((startPad + Number(selected.slice(8)) - 1) / 7) : 0;
  const firstWeek = Math.min(Math.max(0, selectedWeek), Math.max(0, weekCount - weeksShown));
  const gridH = weeksShown * rowH + (weeksShown - 1) * gap;
  const railH = selected ? Math.max(0, boxH - gridH - RAIL_GAP_PX) : 0;

  const go = useCallback((dir: -1 | 1) => {
    setMonth((cur) => {
      const [cy, cm] = cur.split('-').map(Number);
      const off = (cy - Number(here.slice(0, 4))) * 12 + (cm - Number(here.slice(5))) + dir;
      return Math.abs(off) > MAX_MONTHS_AWAY ? cur : shiftMonth(cur, dir);
    });
  }, [here]);

  // A sideways swipe over the grid changes the month. Not one that starts on the day rail, which scrolls sideways itself.
  const swipe = useRef<{ x: number; y: number; t: number } | null>(null);
  const onTouchStart = (e: GestureResponderEvent) => {
    swipe.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, t: Date.now() };
  };
  const onTouchEnd = (e: GestureResponderEvent) => {
    const start = swipe.current;
    swipe.current = null;
    if (!start || Date.now() - start.t > 700) return;
    const dx = e.nativeEvent.pageX - start.x;
    const dy = e.nativeEvent.pageY - start.y;
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    go(dx < 0 ? 1 : -1);
  };

  const railItems = railDay ? byDay.get(railDay) ?? [] : [];
  const close = (
    <Pressable onPress={() => setSelected(null)} accessibilityRole="button" accessibilityLabel="Close this day" hitSlop={14} style={styles.close}>
      <Text style={[type.label, { color: color.textSecondary }]}>Close</Text>
      <X size={14} color={color.textSecondary} />
    </Pressable>
  );

  const toggleScope = (s: Scope) => setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  return (
    <Screen wide>
      <SubBar
        filters={
          <>
            <ScopeFilter active={scopes} onToggle={toggleScope} signedIn={signedIn} onSignIn={() => router.push('/profile')} />
            <Pressable
              onPress={() => setMode((v) => (v === 'month' ? 'agenda' : 'month'))}
              accessibilityRole="button"
              accessibilityLabel={mode === 'month' ? 'Show as a list' : 'Show as a month'}
              hitSlop={2}
              style={styles.circle}>
              {mode === 'month' ? <List size={16} color={color.textSecondary} /> : <CalendarDays size={16} color={color.textSecondary} />}
            </Pressable>
          </>
        }
      />
      <View style={[styles.main, desktop && { paddingHorizontal: 24, paddingTop: 16 }]}>
        {mode === 'agenda' ? (
          <Agenda items={items} kit={kit} />
        ) : (
          <>
            <View style={styles.monthHead}>
              <Pressable onPress={() => go(-1)} disabled={away <= -MAX_MONTHS_AWAY} accessibilityRole="button" accessibilityLabel="Previous month" hitSlop={7} style={styles.arrow}>
                <ChevronLeft size={14} color={color.textSecondary} />
              </Pressable>
              <Text accessibilityRole="header" style={type.serifMd}>{monthLabel(month)}</Text>
              <Pressable onPress={() => go(1)} disabled={away >= MAX_MONTHS_AWAY} accessibilityRole="button" accessibilityLabel="Next month" hitSlop={7} style={styles.arrow}>
                <ChevronRight size={14} color={color.textSecondary} />
              </Pressable>
            </View>
            {/* Always 24 tall, whatever it says, so nothing below it moves. */}
            <View style={styles.status}>
              {loading ? <Text style={type.meta}>Loading releases…</Text>
                : monthItemCount > 0 ? <Text style={type.meta}>{monthItemCount} release{monthItemCount !== 1 ? 's' : ''}</Text> : null}
              {month !== here ? (
                <Pressable onPress={() => setMonth(here)} accessibilityRole="button" hitSlop={12} style={styles.todayChip}>
                  <Text style={[type.meta, { color: color.accent }]}>Today</Text>
                </Pressable>
              ) : null}
            </View>
            <View style={[styles.weekdays, { gap }]}>
              {WEEKDAYS.map((d) => <Text key={d} accessibilityLabel={d} style={[type.micro, styles.weekday]}>{d[0]}</Text>)}
            </View>

            <View style={styles.box} onLayout={onBox} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
              {!loading && monthItemCount === 0 ? (
                <EmptyState
                  icon={<CalendarX size={20} color={color.accent} />}
                  title={`No releases in ${monthLabel(month)}`}
                  hint="Swipe or use the arrows to browse another month, or turn on another source above."
                />
              ) : (
                <>
                  <View style={{ height: gridH, overflow: 'hidden' }}>
                    <View style={{ transform: [{ translateY: -firstWeek * (rowH + gap) }], gap }}>
                      {Array.from({ length: weekCount }, (_, w) => (
                        <View key={w} style={{ flexDirection: 'row', height: rowH, gap }}>
                          {Array.from({ length: 7 }, (_, d) => {
                            const day = w * 7 + d - startPad + 1;
                            if (day < 1 || day > dayCount) return <View key={d} style={{ flex: 1 }} />;
                            const date = `${month}-${pad2(day)}`;
                            return (
                              <Cell
                                key={d} day={day} date={date} items={byDay.get(date) ?? []} stateOf={kit.stateOf}
                                today={date === today} selected={selected === date} desktop={desktop}
                                onOpen={(x) => setSelected((cur) => (cur === x ? null : x))}
                              />
                            );
                          })}
                        </View>
                      ))}
                    </View>
                  </View>
                  <View style={{ height: railH, marginTop: railH > 0 ? RAIL_GAP_PX : 0, overflow: 'hidden' }} onTouchStart={() => { swipe.current = null; }}>
                    {selected && railDay ? (
                      <ScrollView contentContainerStyle={styles.dayRail}>
                        {railItems.length ? (
                          <Rail title={longDay(railDay)} action={close}>
                            {railItems.map((item) => (
                              <PosterCard
                                key={item.key} item={item} style={{ width: 150 }}
                                state={kit.stateOf(item.id)} score={(item.id ? kit.scores.get(item.id) : null) ?? null} center={kit.center} actions={kit.actions}
                              />
                            ))}
                          </Rail>
                        ) : (
                          <View>
                            <View style={styles.railHead}>
                              <Text style={type.serifMd}>{longDay(railDay)}</Text>
                              {close}
                            </View>
                            <Text style={[type.meta, { paddingHorizontal: 4 }]}>Nothing releasing on this day.</Text>
                          </View>
                        )}
                      </ScrollView>
                    ) : null}
                  </View>
                </>
              )}
            </View>
            {note ? <Text style={[type.caption, { paddingVertical: 6 }]}>{note}</Text> : null}
          </>
        )}
      </View>
    </Screen>
  );
}

// ── The list view ────────────────────────────────────────────────────────────

/** What is still to come, in "This week", "Next week" and then by month. */
function Agenda({ items, kit }: { items: CardItem[]; kit: ReturnType<typeof useCardKit> }) {
  const router = useRouter();
  const groups = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOf = (weeks: number) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + (6 - start.getDay()) + weeks * 7, 23, 59, 59);
    const thisWeek = endOf(0);
    const nextWeek = endOf(1);
    const today = todayIso();
    const out: { label: string; items: CardItem[] }[] = [];
    const upcoming = items.filter((i) => i.releaseDate && i.releaseDate.slice(0, 10) >= today)
      .sort((a, b) => ((a.releaseDate as string) < (b.releaseDate as string) ? -1 : 1));
    for (const item of upcoming) {
      const d = new Date(`${(item.releaseDate as string).slice(0, 10)}T12:00:00`);
      const label = d <= thisWeek ? 'This week' : d <= nextWeek ? 'Next week'
        : d.getFullYear() === now.getFullYear() ? MONTHS[d.getMonth()] : `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
      const last = out[out.length - 1];
      if (last?.label === label) last.items.push(item); else out.push({ label, items: [item] });
    }
    return out;
  }, [items]);

  if (!groups.length) {
    return (
      <View style={{ paddingTop: 24 }}>
        <EmptyState icon={<CalendarX size={20} color={color.accent} />} title="Nothing scheduled" hint="No upcoming releases match these filters. Clear a filter, or check back later." />
      </View>
    );
  }
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 44 }}>
      {groups.map((g) => (
        <View key={g.label} style={{ marginBottom: 4 }}>
          <View style={styles.agendaHead}>
            <Text style={[type.eyebrow, { color: color.accent }]}>{g.label}</Text>
            <View style={{ flex: 1, height: 1, backgroundColor: color.border }} />
          </View>
          {g.items.map((item) => {
            const d = new Date(`${(item.releaseDate as string).slice(0, 10)}T00:00:00Z`);
            const tint = color.media[item.type] ?? '#888';
            return (
              <View key={item.key} style={styles.agendaRow}>
                <Pressable onPress={() => router.push(cardHref(item) as never)} accessibilityRole="link" accessibilityLabel={item.title} style={styles.agendaLink}>
                  <View style={{ width: 36, alignItems: 'center' }}>
                    <Text style={type.serifMd}>{d.getUTCDate()}</Text>
                    <Text style={[type.meta, { marginTop: 4 }]}>{MONTHS[d.getUTCMonth()].slice(0, 3)}</Text>
                  </View>
                  <View style={styles.agendaPoster}>
                    {item.posterUrl ? <Img uri={item.posterUrl} width={44} alt="" style={styles.fill} />
                      : <View style={[styles.fill, { alignItems: 'center', justifyContent: 'center' }]}><TypeIcon type={item.type} size={14} /></View>}
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={2} style={type.serifSm}>{item.title}</Text>
                    <Text style={[type.meta, { marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.5, color: tint }]}>{item.type}</Text>
                  </View>
                </Pressable>
                <ActionBar item={item} state={kit.stateOf(item.id)} actions={kit.actions} compact />
              </View>
            );
          })}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
  main: { flex: 1, width: '100%', maxWidth: 1152, alignSelf: 'center', paddingHorizontal: 4, paddingTop: 8, paddingBottom: 4 },
  circles: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  circle: { width: 40, height: 40, borderRadius: radius.full, borderWidth: 1, borderColor: color.borderStrong, alignItems: 'center', justifyContent: 'center' },
  count: {
    position: 'absolute', top: -2, right: -2, minWidth: 16, height: 16, paddingHorizontal: 4, borderRadius: radius.full,
    backgroundColor: color.accent, alignItems: 'center', justifyContent: 'center',
  },
  countText: { fontFamily: font.mono, fontSize: 10, lineHeight: 14, color: color.textOnAccent },
  monthHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, paddingHorizontal: 4 },
  arrow: {
    width: 30, height: 30, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center',
    backgroundColor: color.surfaceElevated, borderWidth: 1, borderColor: color.border,
  },
  status: { height: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  todayChip: { paddingHorizontal: 12, paddingVertical: 2, borderRadius: radius.full, borderWidth: 1, borderColor: color.accent },
  weekdays: { flexDirection: 'row', marginTop: 4, marginBottom: 4 },
  weekday: { flex: 1, textAlign: 'center', paddingVertical: 4 },
  box: { flex: 1, minHeight: 0, overflow: 'hidden' },
  cell: { flex: 1, minWidth: 0, borderWidth: 1, overflow: 'hidden' },
  cellBody: { flex: 1 },
  todayDot: { width: 16, height: 16, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: color.accent },
  todayText: { fontFamily: font.mono, fontSize: 10, lineHeight: 12, color: color.textOnAccent },
  cellTitle: { fontFamily: font.serif, fontSize: 11, lineHeight: 13.5, color: color.textPrimary },
  cellRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cellRowText: { flexShrink: 1, fontFamily: font.mono, fontSize: 10, lineHeight: 12.5, color: color.textSecondary },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaRating: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  metaRatingText: { fontFamily: font.mono, fontSize: 9, lineHeight: 11, color: color.accent },
  dayRail: { borderTopWidth: 1, borderTopColor: color.border, paddingTop: 16, paddingHorizontal: 4 },
  railHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12, paddingHorizontal: 4 },
  close: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  agendaHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 4 },
  agendaRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8,
    backgroundColor: color.surfaceElevated, borderWidth: 1, borderColor: color.border, borderRadius: radius.lg,
  },
  agendaLink: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 },
  agendaPoster: { width: 44, height: 56, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: color.neutral800, borderWidth: 1, borderColor: color.border },
});
