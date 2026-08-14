"use client";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  format, isToday, isSameMonth, startOfMonth, endOfMonth, eachDayOfInterval,
  addMonths, subMonths, getDay, parseISO, startOfDay, startOfWeek, endOfWeek,
  addWeeks, compareAsc,
} from "date-fns";
import { ChevronLeft, ChevronRight, X, Star, Bookmark, Check, CalendarX } from "lucide-react";
import { TYPE_COLORS } from "@/lib/constants";
import { TypeIcon } from "@/components/Badges";
import Tooltip from "@/components/Tooltip";
import EmptyState from "@/components/ui/EmptyState";
import ActionCells from "@/components/ActionCells";
import Rail from "@/components/Rail";
import PosterCard from "@/components/PosterCard";
import type { MediaCardItem } from "@/components/cardItem";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { scrollBehavior } from "@/lib/scrollBehavior";
import { upcomingFrom } from "@/lib/upcoming";

// CalendarView accepts any item that has the minimum required fields.
// Both EnrichedItem (wishlist) and discover items satisfy this.
export interface CalendarItem {
  id: string;
  type: string;
  title: string;
  releaseDate: string | null;
  posterUrl: string | null;
  // Wishlist items have platformSources; discover items have onWatchlist
  platformSources?: string[];
  onWatchlist?: boolean;
  // Library state (watched/played + personal rating), when known
  libraryStatus?: string | null;
  rating?: number | null;
}

export type CalendarMode = "month" | "agenda";

interface CalendarViewProps {
  items: CalendarItem[];
  onSelect: (item: CalendarItem) => void;
  // Fired whenever the displayed month changes (and on mount). Lets a parent
  // fetch more data when the user pages past the end of what's been loaded.
  onVisibleMonthChange?: (month: Date) => void;
  // Month grid vs. agenda list. Owned by the PAGE since 2026-07-28: the toggle
  // that used to live in this component's "Coming up" header row now sits in
  // the shared SubBar with every other page-level control, and the page needs
  // to read the mode anyway to decide how far ahead to prefetch.
  mode?: CalendarMode;
}

function groupByDate(items: CalendarItem[]) {
  const groups: Record<string, CalendarItem[]> = {};
  for (const item of items) {
    if (!item.releaseDate) continue;
    if (!groups[item.releaseDate]) groups[item.releaseDate] = [];
    groups[item.releaseDate].push(item);
  }
  return groups;
}

// Compact type-icon + rating/wishlist/library indicator cluster shared by the
// month grid's hover rows, its overflow drawer, and the Agenda view. Replaces
// the old ItemBadges "calendar" variant (H1.6d) with token-driven colors:
// accent for personal-preference signals (rating, wishlist), success for the
// distinct in-library/completion signal — same convention ActionCells uses.
function ItemMeta({ item, size = 11 }: { item: CalendarItem; size?: number }) {
  const typeColor = TYPE_COLORS[item.type] ?? "#888";
  const rating = typeof item.rating === "number" && item.rating > 0 ? item.rating : null;
  const onWatchlist = item.onWatchlist ?? (item.platformSources?.length ?? 0) > 0;
  const inLibrary = !!item.libraryStatus;
  return (
    <span className="inline-flex items-center gap-1 flex-shrink-0">
      <span style={{ color: typeColor }}><TypeIcon type={item.type} size={size} /></span>
      {rating !== null && (
        <span className="inline-flex items-center gap-0.5 font-mono text-[9px] font-semibold text-accent">
          <Star className="w-2.5 h-2.5 fill-current" aria-hidden />{rating % 1 === 0 ? rating.toFixed(0) : rating.toFixed(1)}
        </span>
      )}
      {inLibrary && <Check className="w-2.5 h-2.5 text-success" aria-hidden />}
      {onWatchlist && <Bookmark className="w-2.5 h-2.5 text-accent fill-current" aria-hidden />}
    </span>
  );
}

function HoverableCalendarItem({ item, onSelect }: { item: CalendarItem; onSelect: (item: CalendarItem) => void }) {
  const [hovered, setHovered] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  return (
    <>
      <button
        ref={ref}
        className="flex items-center gap-1 text-left w-full hover:opacity-75 transition-opacity duration-fast"
        onMouseEnter={() => { timer.current = setTimeout(() => setHovered(true), 350); }}
        onMouseLeave={() => { if (timer.current) clearTimeout(timer.current); setHovered(false); }}
        onClick={() => onSelect(item)}
      >
        <ItemMeta item={item} />
        <span className="font-mono text-[10px] text-text-secondary truncate leading-tight">{item.title}</span>
      </button>
      {hovered && <Tooltip item={item} anchorRef={ref} />}
    </>
  );
}

function CalendarCell({
  day,
  dayItems,
  onSelect,
  onOpenDay,
  selected,
  isDesktop,
}: {
  day: Date;
  dayItems: CalendarItem[];
  onSelect: (item: CalendarItem) => void;
  /** MB8 — open this day's carousel below the grid. `yyyy-MM-dd`. */
  onOpenDay: (dateStr: string) => void;
  selected: boolean;
  isDesktop: boolean;
}) {
  const [singleHovered, setSingleHovered] = useState(false);
  const singleRef = useRef<HTMLDivElement>(null);
  const singleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const today = isToday(day);
  const single = dayItems.length === 1 ? dayItems[0] : null;
  // A mobile cell is 80px tall, which fits two title rows plus the "+N more"
  // link; three would clip. Desktop's 128px still fits three.
  const VISIBLE = isDesktop ? 3 : 2;
  const overflow = dayItems.length > VISIBLE;
  // MB8: a day with more than one release opens the carousel below the grid.
  // A single-release day still goes straight to the item — a one-card carousel
  // would be a worse version of the click you already made.
  const multi = dayItems.length > 1;

  return (
    <div
      className={`h-20 md:h-32 rounded-sm md:rounded-md overflow-visible relative border transition-colors duration-base ${
        today ? "ring-2 ring-accent ring-inset" : ""
      } ${selected ? "ring-2 ring-accent" : ""} ${
        single ? "" : dayItems.length > 0 ? "border-border-strong bg-surface-elevated/40" : "border-border/60"
      }`}
      style={single ? { borderColor: `${TYPE_COLORS[single.type] ?? "#888"}44` } : undefined}
    >
      {/* The cell-wide open target for a multi-release day, UNDER the content
          (z-0 vs the content's z-10) so the individual title buttons on desktop
          still take their own clicks. On mobile those titles are 10px tall and
          effectively unhittable, so nearly every tap lands here — which is the
          point. A real <button>, so it's keyboard- and screen-reader-reachable
          rather than a click handler on a div. */}
      {multi && (
        <button
          type="button"
          onClick={() => onOpenDay(format(day, "yyyy-MM-dd"))}
          aria-label={`${format(day, "MMMM d")} — show all ${dayItems.length} releases`}
          aria-expanded={selected}
          className="absolute inset-0 z-0 rounded-sm md:rounded-md cursor-pointer"
        />
      )}
      {single && single.posterUrl && (
        <>
          <Image
            src={single.posterUrl}
            alt={single.title}
            fill
            sizes="(max-width: 768px) 14vw, 120px"
            className="object-cover opacity-40 rounded-sm md:rounded-md"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-neutral-950/90 via-neutral-950/30 to-transparent rounded-sm md:rounded-md" />
        </>
      )}

      <div className="relative z-10 p-1 md:p-2 h-full flex flex-col">
        {/* Day number */}
        <div className="mb-0.5 md:mb-1">
          {today ? (
            <span className="inline-flex items-center justify-center w-4 h-4 md:w-5 md:h-5 rounded-full bg-accent text-text-on-accent font-bold font-mono text-[10px]">
              {format(day, "d")}
            </span>
          ) : (
            <span className="font-mono text-meta text-text-secondary">{format(day, "d")}</span>
          )}
        </div>

        {single ? (
          <>
            <div
              ref={singleRef}
              tabIndex={0}
              role="button"
              aria-label={`${single.title} — view details`}
              className="flex-1 flex flex-col justify-end cursor-pointer"
              onMouseEnter={() => { singleTimer.current = setTimeout(() => setSingleHovered(true), 350); }}
              onMouseLeave={() => { if (singleTimer.current) clearTimeout(singleTimer.current); setSingleHovered(false); }}
              onClick={() => onSelect(single)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(single); } }}
            >
              <p className="font-serif text-[11px] md:text-[13px] leading-tight line-clamp-2 text-text-primary drop-shadow">{single.title}</p>
              <div className="mt-0.5"><ItemMeta item={single} /></div>
            </div>
            {singleHovered && <Tooltip item={single} anchorRef={singleRef} />}
          </>
        ) : dayItems.length > 0 ? (
          <div className="flex-1 flex flex-col gap-0.5 overflow-hidden">
            {dayItems.slice(0, VISIBLE).map((item) => (
              <HoverableCalendarItem key={item.id} item={item} onSelect={onSelect} />
            ))}
            {overflow && (
              /* Now opens the same day carousel the cell does, rather than the
                 old popover/bottom-sheet. Kept as its own control because it
                 carries the COUNT, which the bare cell doesn't. */
              <button
                className="relative z-10 mt-auto self-start font-mono text-[10px] text-text-secondary hover:text-text-primary transition-colors"
                onClick={(e) => { e.stopPropagation(); onOpenDay(format(day, "yyyy-MM-dd")); }}
              >
                +{dayItems.length - VISIBLE} more
              </button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── Agenda (list) view — H1.6d, new per the design's A1 delta ────────────────
// Grouped by "This week / Next week / <Month>", each item a ListRow-style row
// with a date stack + poster thumb + title/type/platform meta. Strictly
// forward-looking (today onward) to match the "Coming up" framing — the Month
// grid already covers browsing past releases via its prev/next controls.

function AgendaRow({ item, onSelect }: { item: CalendarItem; onSelect: (item: CalendarItem) => void }) {
  const typeColor = TYPE_COLORS[item.type] ?? "#888";
  const day = item.releaseDate ? parseISO(item.releaseDate) : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(item)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(item); } }}
      className="flex items-center gap-3 px-3 py-2.5 mb-2 rounded-lg bg-surface-elevated border border-border hover:border-border-strong transition-colors duration-base cursor-pointer"
    >
      <div className="flex-none w-9 text-center">
        <div className="font-serif text-serif-md leading-none text-text-primary">{day ? format(day, "d") : "–"}</div>
        <div className="font-mono text-meta text-text-secondary mt-1">{day ? format(day, "MMM") : ""}</div>
      </div>
      <div className="relative flex-none w-11 h-14 rounded-sm overflow-hidden bg-neutral-800 border border-border">
        {item.posterUrl ? (
          <Image src={item.posterUrl} alt={item.title} fill sizes="44px" className="object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center"><TypeIcon type={item.type} size={14} className="text-text-muted" /></div>
        )}
        <span className="absolute top-1 left-1 w-1.5 h-1.5 rounded-xs" style={{ background: typeColor }} aria-hidden />
      </div>
      <div className="flex-1 min-w-0">
        {/* SM28 (2026-07-28, re-measured post-L4): even after L4's mobile
            density pass, the row's fixed date-stack (36px) + poster (44px) +
            action bar (94px) leave only ~132px for the title at 375px —
            single-line truncate clipped most titles to ~15-18 characters
            ("Beast of Reincarn…"). The date/poster/actions can't shrink
            further without hurting tap targets or legibility, so the fix is
            vertical, not horizontal: line-clamp-2 uses the row's existing
            height budget (the poster is 56px tall, room for 2 text lines +
            the meta line below) to show ~30-36 characters before truncating. */}
        <p className="font-serif text-serif-sm text-text-primary line-clamp-2">{item.title}</p>
        <div className="flex items-center gap-1.5 mt-1 font-mono text-meta uppercase tracking-wide" style={{ color: typeColor }}>
          <span>{item.type}</span>
          {item.platformSources && item.platformSources.length > 0 && (
            <>
              <span className="w-0.5 h-0.5 rounded-full bg-border-strong" aria-hidden />
              <span className="text-text-secondary normal-case tracking-normal">{item.platformSources.join(" · ")}</span>
            </>
          )}
        </div>
      </div>
      <ActionCells item={item} layout="row" />
    </div>
  );
}

function AgendaView({ items, onSelect }: { items: CalendarItem[]; onSelect: (item: CalendarItem) => void }) {
  const groups = useMemo(() => {
    const now = startOfDay(new Date());
    const thisWeekEnd = endOfWeek(now, { weekStartsOn: 0 });
    const nextWeekEnd = endOfWeek(addWeeks(now, 1), { weekStartsOn: 0 });
    const thisYear = now.getFullYear();

    const bucketLabel = (d: Date): string => {
      if (compareAsc(d, thisWeekEnd) <= 0) return "This week";
      if (compareAsc(d, nextWeekEnd) <= 0) return "Next week";
      return d.getFullYear() === thisYear ? format(d, "MMMM") : format(d, "MMMM yyyy");
    };

    const upcoming = upcomingFrom(items, now)
      .map((it) => ({ item: it, date: parseISO(it.releaseDate as string) }))
      .sort((a, b) => compareAsc(a.date, b.date));

    const out: { label: string; items: CalendarItem[] }[] = [];
    for (const { item, date } of upcoming) {
      const label = bucketLabel(date);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(item);
      else out.push({ label, items: [item] });
    }
    return out;
  }, [items]);

  if (groups.length === 0) {
    return (
      <EmptyState
        icon={<CalendarX className="w-5 h-5" aria-hidden />}
        title="Nothing scheduled"
        hint="No upcoming releases match these filters. Clear a filter, or check back later."
      />
    );
  }

  return (
    <div>
      {groups.map((group) => (
        <div key={group.label} className="mb-1">
          <div className="flex items-center gap-2.5 py-2">
            <span className="font-mono text-eyebrow uppercase text-accent">{group.label}</span>
            <span className="flex-1 h-px bg-border" aria-hidden />
          </div>
          {group.items.map((item) => (
            <AgendaRow key={item.id} item={item} onSelect={onSelect} />
          ))}
        </div>
      ))}
    </div>
  );
}

export default function CalendarView({ items, onSelect, onVisibleMonthChange, mode = "month" }: CalendarViewProps) {
  const [calMonth, setCalMonth] = useState(new Date());
  // MB8: the open day, as `yyyy-MM-dd`. A string, not a Date — two Dates for the
  // same day are never ===, so the cell's `selected` check would silently never
  // match and the highlight would never appear.
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const dayRailRef = useRef<HTMLDivElement>(null);
  const isDesktop = useMediaQuery("(min-width: 768px)");

  useEffect(() => {
    onVisibleMonthChange?.(calMonth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calMonth]);

  // Changing month must drop the open day: its rail would otherwise keep showing
  // titles from a month no longer on screen, with no cell highlighted anywhere.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedDay(null);
  }, [calMonth]);

  const monthStart    = startOfMonth(calMonth);
  const monthEnd      = endOfMonth(calMonth);
  const days          = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const startPad      = getDay(monthStart);
  const groups        = groupByDate(items);
  const isCurrentMonth = isSameMonth(calMonth, new Date());

  const selectedDayItems = selectedDay ? (groups[selectedDay] ?? []) : [];
  const selectedDayLabel = selectedDay ? format(parseISO(selectedDay), "EEEE, MMMM d") : "";

  // Bring the rail into view when a day is opened. Without this the rail can
  // land below the fold on a tall month and the tap reads as doing nothing —
  // the same "I thought nothing happened" failure MB6 fixed on Insights.
  useEffect(() => {
    if (!selectedDay) return;
    dayRailRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: "nearest" });
  }, [selectedDay]);

  const monthItemCount = days.reduce((acc, day) => acc + (groups[format(day, "yyyy-MM-dd")]?.length ?? 0), 0);

  // The "← Previous release" / "Next release →" jumps that used to sit in the
  // utility row (and again in the empty-month state) were removed 2026-07-28 at
  // Nils's request — obsolete now that the Popular scope means most months have
  // something in them, and they were crowding "Today" out of its own row.

  return (
    <div>
      {mode === "agenda" ? (
        <AgendaView items={items} onSelect={onSelect} />
      ) : (
        <>
          {/* Month navigation — 03-components.md's calendar.html shows a
              plain 3-part row (chevron / serif month / chevron); the
              "jump to nearest release" + "Today" controls the board flagged
              as a real gap (H1.6d) don't fit in that row at mobile widths —
              cramming all 5 into one flex row wrapped unpredictably and
              split the corner arrows away from the month label (2026-07-27,
              found via "the calendar looks broken"). Fixed by giving the
              extra controls their OWN row underneath, which can wrap freely
              without fracturing the primary nav. */}
          <div className="flex items-center justify-between mb-1">
            <button
              onClick={() => setCalMonth(subMonths(calMonth, 1))}
              aria-label="Previous month"
              className="tap-44 w-[30px] h-[30px] shrink-0 rounded-lg bg-surface-elevated border border-border flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors duration-fast"
            >
              <ChevronLeft className="w-3.5 h-3.5" aria-hidden />
            </button>
            <h2 className="font-serif text-serif-md text-text-primary">{format(calMonth, "MMMM yyyy")}</h2>
            <button
              onClick={() => setCalMonth(addMonths(calMonth, 1))}
              aria-label="Next month"
              className="tap-44 w-[30px] h-[30px] shrink-0 rounded-lg bg-surface-elevated border border-border flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors duration-fast"
            >
              <ChevronRight className="w-3.5 h-3.5" aria-hidden />
            </button>
          </div>

          {/* Utility row — the release count, and "Today" with room to breathe
              now that the two jump buttons are gone. Today is a real pill with
              a 44px hit area; as a bare text link squeezed between four other
              controls it was the smallest tap target on the page. */}
          {(monthItemCount > 0 || !isCurrentMonth) && (
            <div className="flex items-center justify-center flex-wrap gap-x-3 gap-y-1 mb-4 font-mono text-meta text-text-secondary">
              {monthItemCount > 0 && <span>{monthItemCount} release{monthItemCount !== 1 ? "s" : ""}</span>}
              {!isCurrentMonth && (
                <button
                  onClick={() => setCalMonth(new Date())}
                  className="tap-44 px-3 py-1 rounded-full border border-accent text-accent hover:bg-accent-subtle transition-colors duration-fast"
                >
                  Today
                </button>
              )}
            </div>
          )}

          {monthItemCount === 0 ? (
            <EmptyState
              icon={<CalendarX className="w-5 h-5" aria-hidden />}
              title={`No releases in ${format(calMonth, "MMMM yyyy")}`}
              hint="Use the arrows to browse another month, or turn on another source above."
            />
          ) : (
            <>
              {/* Day-of-week headers — single-letter per the mockup, full name
                  kept for screen readers via aria-label. */}
              <div className="grid grid-cols-7 gap-0.5 md:gap-1.5 mb-1 md:mb-1.5">
                {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d) => (
                  <div key={d} aria-label={d} className="text-center font-mono text-micro text-text-secondary py-1">
                    <span aria-hidden>{d[0]}</span>
                  </div>
                ))}
              </div>

              {/* Calendar grid. The current month used to get a `bg-accent-subtle`
                  tint here (with a p-2/-m-2 pair whose ONLY job was letting that
                  tint bleed past the cells) — removed 2026-07-28, Nils's call.
                  Today's cell keeps its accent ring and day-number pill, which
                  is the signal that was actually doing the work.
                  Mobile gaps are 2px, not 6px: at 375px the six gaps plus the
                  page's old px-6 were eating a fifth of the screen width. */}
              <div className="grid grid-cols-7 gap-0.5 md:gap-1.5">
                {Array.from({ length: startPad }).map((_, i) => (
                  <div key={`pad-${i}`} className="h-20 md:h-32 rounded-sm md:rounded-md" />
                ))}
                {days.map((day) => {
                  const dateStr  = format(day, "yyyy-MM-dd");
                  const dayItems = groups[dateStr] || [];
                  return (
                    <CalendarCell
                      key={day.toISOString()}
                      day={day}
                      dayItems={dayItems}
                      onSelect={onSelect}
                      onOpenDay={setSelectedDay}
                      selected={selectedDay === dateStr}
                      isDesktop={isDesktop}
                    />
                  );
                })}
              </div>

              {/* MB8 (2026-08-14) — Nils: "when clicking a day with multiple
                  entries, I want them to open in a carousel below the month
                  view." This replaces the popover/bottom-sheet the "+N more"
                  link used to open. Below the grid rather than over it, so the
                  month stays readable while you browse the day — the popover
                  covered the following week and the sheet covered everything.
                  Full PosterCards, so a day's titles get the same artwork,
                  score and quick actions they have everywhere else; the cell's
                  own 10px text lines never could. */}
              {selectedDayItems.length > 0 && (
                <div ref={dayRailRef} className="mt-5 pt-5 border-t border-border scroll-mt-24">
                  <Rail
                    title={selectedDayLabel}
                    action={
                      <button
                        onClick={() => setSelectedDay(null)}
                        aria-label="Close this day"
                        className="tap-44 inline-flex items-center gap-1 text-label text-text-secondary hover:text-text-primary transition-colors"
                      >
                        Close
                        <X className="w-3.5 h-3.5" aria-hidden />
                      </button>
                    }
                  >
                    {selectedDayItems.map((item) => (
                      <PosterCard key={item.id} item={item as MediaCardItem} onSelect={() => onSelect(item)} />
                    ))}
                  </Rail>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
