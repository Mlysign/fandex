"use client";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  format, isToday, isSameMonth, startOfMonth, endOfMonth, eachDayOfInterval,
  addMonths, subMonths, getDay, parseISO, startOfDay, startOfWeek, endOfWeek,
  addWeeks, compareAsc,
} from "date-fns";
import { ChevronLeft, ChevronRight, List, CalendarDays, BellPlus, X, Star, Bookmark, Check, CalendarX } from "lucide-react";
import { TYPE_COLORS } from "@/lib/constants";
import { TypeIcon } from "@/components/Badges";
import Tooltip from "@/components/Tooltip";
import EmptyState from "@/components/ui/EmptyState";
import { useQuickActions } from "@/lib/useQuickActions";

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

interface CalendarViewProps {
  items: CalendarItem[];
  onSelect: (item: CalendarItem) => void;
  // Fired whenever the displayed month changes (and on mount). Lets a parent
  // fetch more data when the user pages past the end of what's been loaded.
  onVisibleMonthChange?: (month: Date) => void;
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

function OverflowDrawer({
  items,
  dateLabel,
  onSelect,
  onClose,
}: {
  items: CalendarItem[];
  dateLabel: string;
  onSelect: (item: CalendarItem) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-surface-overlay border border-border-strong rounded-xl shadow-2xl overflow-hidden min-w-[220px]">
        <div className="px-3 py-2 border-b border-border flex items-center justify-between">
          <span className="font-mono text-meta text-text-secondary">{dateLabel}</span>
          <button onClick={onClose} aria-label="Close" className="text-text-secondary hover:text-text-primary">
            <X className="w-3.5 h-3.5" aria-hidden />
          </button>
        </div>
        <div className="max-h-64 overflow-y-auto">
          {items.map((item) => (
            <button
              key={item.id}
              className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-surface-elevated transition-colors duration-fast text-left"
              onClick={() => { onClose(); onSelect(item); }}
            >
              {item.posterUrl && (
                <Image src={item.posterUrl} alt={item.title} width={32} height={24} className="w-8 h-6 rounded-sm object-cover flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-caption font-medium text-text-primary truncate">{item.title}</p>
                <div className="mt-0.5"><ItemMeta item={item} /></div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </>
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
}: {
  day: Date;
  dayItems: CalendarItem[];
  onSelect: (item: CalendarItem) => void;
}) {
  const [showOverflow, setShowOverflow] = useState(false);
  const [singleHovered, setSingleHovered] = useState(false);
  const singleRef = useRef<HTMLDivElement>(null);
  const singleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const today = isToday(day);
  const single = dayItems.length === 1 ? dayItems[0] : null;
  const VISIBLE = 3;
  const overflow = dayItems.length > VISIBLE;

  return (
    <div
      className={`h-32 rounded-md overflow-visible relative border transition-colors duration-base ${
        today ? "ring-2 ring-accent ring-inset" : ""
      } ${single ? "" : dayItems.length > 0 ? "border-border-strong bg-surface-elevated/40" : "border-border/60"}`}
      style={single ? { borderColor: `${TYPE_COLORS[single.type] ?? "#888"}44` } : undefined}
    >
      {single && single.posterUrl && (
        <>
          <Image
            src={single.posterUrl}
            alt={single.title}
            fill
            sizes="(max-width: 768px) 14vw, 120px"
            className="object-cover opacity-40 rounded-md"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-neutral-950/90 via-neutral-950/30 to-transparent rounded-md" />
        </>
      )}

      <div className="relative z-10 p-2 h-full flex flex-col">
        {/* Day number */}
        <div className="mb-1">
          {today ? (
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-accent text-text-on-accent font-bold font-mono text-[10px]">
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
              <p className="font-serif text-[13px] leading-tight line-clamp-2 text-text-primary drop-shadow">{single.title}</p>
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
              <div className="relative mt-auto">
                <button
                  className="font-mono text-[10px] text-text-secondary hover:text-text-primary transition-colors duration-fast"
                  onClick={(e) => { e.stopPropagation(); setShowOverflow(true); }}
                >
                  +{dayItems.length - VISIBLE} more
                </button>
                {showOverflow && (
                  <OverflowDrawer
                    items={dayItems}
                    dateLabel={format(day, "MMMM d")}
                    onSelect={onSelect}
                    onClose={() => setShowOverflow(false)}
                  />
                )}
              </div>
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
  const { wishlisted, busy, toggleWishlist } = useQuickActions(item);
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
        <p className="font-serif text-serif-sm text-text-primary truncate">{item.title}</p>
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
      {/* D-C: the design's Agenda-row BellPlus (reminder) has no backing
          system — repurposed as add-to-wishlist, same icon, real action. */}
      <button
        onClick={(e) => { e.stopPropagation(); toggleWishlist(); }}
        disabled={busy}
        aria-pressed={wishlisted}
        aria-label={wishlisted ? `Remove ${item.title} from your wishlist` : `Add ${item.title} to your wishlist`}
        title={wishlisted ? "On your wishlist" : "Add to wishlist"}
        className={`flex-none w-9 h-9 rounded-lg border flex items-center justify-center transition-colors duration-fast disabled:opacity-40 ${
          wishlisted ? "border-accent/50 bg-accent-subtle text-accent" : "border-border text-text-secondary hover:text-text-primary hover:bg-surface-overlay"
        }`}
      >
        <BellPlus className="w-4 h-4" aria-hidden />
      </button>
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

    const upcoming = items
      .filter((it) => it.releaseDate)
      .map((it) => ({ item: it, date: parseISO(it.releaseDate as string) }))
      .filter(({ date }) => compareAsc(date, now) >= 0)
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

export default function CalendarView({ items, onSelect, onVisibleMonthChange }: CalendarViewProps) {
  const [calMonth, setCalMonth] = useState(new Date());
  const [mode, setMode] = useState<"month" | "agenda">("month");

  useEffect(() => {
    onVisibleMonthChange?.(calMonth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calMonth]);

  const monthStart    = startOfMonth(calMonth);
  const monthEnd      = endOfMonth(calMonth);
  const days          = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const startPad      = getDay(monthStart);
  const groups        = groupByDate(items);
  const isCurrentMonth = isSameMonth(calMonth, new Date());

  const monthItemCount = days.reduce((acc, day) => acc + (groups[format(day, "yyyy-MM-dd")]?.length ?? 0), 0);

  // Distinct months (as start-of-month timestamps) that actually hold a release,
  // so the user can skip empty stretches instead of paging one month at a time.
  const monthStarts = useMemo(() => {
    const set = new Set<number>();
    for (const it of items) {
      if (!it.releaseDate) continue;
      set.add(startOfMonth(parseISO(it.releaseDate)).getTime());
    }
    return [...set].sort((a, b) => a - b);
  }, [items]);
  const curStart = startOfMonth(calMonth).getTime();
  const nextMonthWithItems = monthStarts.find((m) => m > curStart) ?? null;
  const prevMonthWithItems = [...monthStarts].reverse().find((m) => m < curStart) ?? null;

  return (
    <div>
      {/* Section header + Month/Agenda toggle (H1.6d — the introduced Agenda view) */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-serif text-serif-md text-text-primary">Coming up</h3>
        <button
          onClick={() => setMode((m) => (m === "month" ? "agenda" : "month"))}
          className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-surface-elevated border border-border text-text-primary text-label hover:border-border-strong transition-colors duration-fast"
        >
          {mode === "month" ? (
            <><List className="w-3.5 h-3.5" aria-hidden />List</>
          ) : (
            <><CalendarDays className="w-3.5 h-3.5" aria-hidden />Month</>
          )}
        </button>
      </div>

      {mode === "agenda" ? (
        <AgendaView items={items} onSelect={onSelect} />
      ) : (
        <>
          {/* Month navigation */}
          <div className="flex items-center justify-between mb-5 flex-wrap gap-y-2">
            <button
              onClick={() => setCalMonth(subMonths(calMonth, 1))}
              aria-label="Previous month"
              className="p-2 hover:bg-surface-elevated rounded-lg text-text-secondary hover:text-text-primary transition-colors duration-fast"
            >
              <ChevronLeft className="w-4 h-4" aria-hidden />
            </button>
            <div className="flex items-center gap-2.5 flex-wrap justify-center">
              {prevMonthWithItems != null && (
                <button
                  onClick={() => setCalMonth(new Date(prevMonthWithItems))}
                  className="font-mono text-meta px-3 py-1.5 rounded-full border border-border-strong text-text-secondary hover:bg-surface-elevated transition-colors duration-fast whitespace-nowrap"
                  title="Jump to the previous month with a release"
                >
                  ← Previous release
                </button>
              )}
              <div className="text-center">
                {isCurrentMonth ? (
                  <h2 className="font-mono text-eyebrow px-3 py-1.5 rounded-full bg-accent text-text-on-accent uppercase tracking-widest inline-block">
                    {format(calMonth, "MMMM yyyy")}
                  </h2>
                ) : (
                  <h2 className="font-serif text-serif-md text-text-primary">{format(calMonth, "MMMM yyyy")}</h2>
                )}
                {monthItemCount > 0 && (
                  <p className="font-mono text-meta text-text-secondary mt-1">{monthItemCount} release{monthItemCount !== 1 ? "s" : ""}</p>
                )}
              </div>
              {!isCurrentMonth && (
                <button
                  onClick={() => setCalMonth(new Date())}
                  className="text-label px-3 py-1.5 bg-accent text-text-on-accent hover:bg-accent-hover font-semibold rounded-full transition-colors duration-fast"
                >
                  Today
                </button>
              )}
              {nextMonthWithItems != null && (
                <button
                  onClick={() => setCalMonth(new Date(nextMonthWithItems))}
                  className="font-mono text-meta px-3 py-1.5 rounded-full border border-border-strong text-text-secondary hover:bg-surface-elevated transition-colors duration-fast whitespace-nowrap"
                  title="Jump to the next month with a release"
                >
                  Next release →
                </button>
              )}
            </div>
            <button
              onClick={() => setCalMonth(addMonths(calMonth, 1))}
              aria-label="Next month"
              className="p-2 hover:bg-surface-elevated rounded-lg text-text-secondary hover:text-text-primary transition-colors duration-fast"
            >
              <ChevronRight className="w-4 h-4" aria-hidden />
            </button>
          </div>

          {monthItemCount === 0 ? (
            // Empty month — offer to skip straight to a month that has releases.
            <EmptyState
              icon={<CalendarX className="w-5 h-5" aria-hidden />}
              title={`No releases in ${format(calMonth, "MMMM yyyy")}`}
              hint={prevMonthWithItems == null && nextMonthWithItems == null ? "No dated releases here yet." : undefined}
              actions={
                prevMonthWithItems == null && nextMonthWithItems == null ? undefined : (
                  <>
                    {prevMonthWithItems != null && (
                      <button
                        onClick={() => setCalMonth(new Date(prevMonthWithItems))}
                        className="text-label px-3 py-1.5 rounded-full border border-border-strong text-text-secondary hover:bg-surface-elevated transition-colors duration-fast"
                      >
                        ← Previous release
                      </button>
                    )}
                    {nextMonthWithItems != null && (
                      <button
                        onClick={() => setCalMonth(new Date(nextMonthWithItems))}
                        className="text-label px-3 py-1.5 rounded-full bg-accent text-text-on-accent font-semibold hover:bg-accent-hover transition-colors duration-fast"
                      >
                        Jump to next release →
                      </button>
                    )}
                  </>
                )
              }
            />
          ) : (
            <>
              {/* Day-of-week headers */}
              <div className="grid grid-cols-7 gap-1.5 mb-1.5">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                  <div key={d} className="text-center font-mono text-micro text-text-secondary py-1">{d}</div>
                ))}
              </div>

              {/* Calendar grid — subtle accent tint on current month */}
              <div
                className={`grid grid-cols-7 gap-1.5 rounded-xl p-2 -m-2 transition-colors duration-base ${isCurrentMonth ? "bg-accent-subtle" : ""}`}
              >
                {Array.from({ length: startPad }).map((_, i) => (
                  <div key={`pad-${i}`} className="h-32 rounded-md" />
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
                    />
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
