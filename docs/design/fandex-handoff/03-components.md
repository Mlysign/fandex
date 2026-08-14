# 03 · Components — Fandex (Direction 2a "Ticket · Calm")

Token names below refer to `01-tokens.css` (e.g. `--color-accent`). "AA" notes
point to measured ratios in `06-accessibility.md`. Icons are **lucide-react**
component names (import in PascalCase, e.g. `Search` → `<Search/>`). All
interactive targets are **≥44×44px** on mobile even when the visible glyph is
smaller — pad to the target.

Global interaction rules (apply to every interactive component unless noted):

- **focus-visible:** `--shadow-focus` (2px surface gap + 2px `--color-accent`
  ring). Never remove outline without replacing it. Keyboard-only (`:focus-visible`),
  not on mouse `:focus`.
- **disabled:** `opacity: 0.4`, `cursor: not-allowed`, no hover/active response,
  `aria-disabled="true"`.
- **transition:** `--transition-duration-fast` / `--ease-standard` for hover & press;
  `--transition-duration-base` for selected/color changes.
- **reduced-motion:** see 06 — transforms drop to opacity-only.

---

## 1. Adaptive Navigation  (`<AppNav>`)

ONE component, two layouts by breakpoint (`--breakpoint-desktop` = 768px).
Destinations map to the locked IA.

**Anatomy:** brand mark · primary destination items (icon + label) · trailing
slot (search entry on desktop, notifications/avatar).

**Destinations & icons (order):**
| Item | Route | Lucide |
|---|---|---|
| Home | `/` | `House` |
| Discover | `/discover` | `Search` |
| Calendar | `/calendar` | `CalendarDays` |
| Library | `/library` | `Library` |
| Profile | `/profile` | `User` |

Wishlist (`/wishlist`) and Insights (`/insights`) are **not** top-level nav
items — they are reached from Library and Profile respectively (see 05-DELTA
§b). Settings (`/settings`) lives under Profile.

**Mobile (< 768px): bottom bar.**
- Height `--size-nav-bar-mobile` (64px) + `env(safe-area-inset-bottom)`.
- Surface `--color-surface`, top border `--color-border`.
- 5 items, evenly distributed, each a 44px-min column: icon 20px + `--text-micro`
  UPPERCASE mono label.
- Discover here is the **Search** entry (label "SEARCH", `Search` icon).

**Desktop (≥ 768px): top bar.**
- Height `--size-nav-bar-desktop` (60px), sticky, surface `--color-surface`,
  bottom border `--color-border`, content max `--container-max`, 44px gutters.
- Left: brand (stacked-card mark + "Fandex" in serif 21px). Center/left-aligned:
  destination items as text with 20px icon, horizontal.
- Right trailing slot: a search field (see §8, collapsed to icon under 900px)
  and avatar button.

**States (per item):**
- default: icon+label `--color-text-muted` (see a11y note — desktop text items
  use `--color-neutral-400` min).
- hover: `--color-text-secondary`; label unchanged size.
- active/selected (current route): `--color-accent`, `aria-current="page"`.
- focus-visible: `--shadow-focus` on the item box.
- No disabled state.

---

## 2. Poster Card  (`<PosterCard>`)

The primary content unit. Used in rails and 2-up grids.

**Anatomy:** poster image (2:3) · media-type chip (top-left) · optional Score
badge or ★rating (bottom overlay / meta row) · title · meta row (release · score)
· quick-action bar (Rate + Bookmark).

**Dimensions:** rail width 150px; grid cell fills `1fr` of a 2-col grid (≈146px
at 344px inner). Poster `aspect-ratio: 2/3`, `--radius-md`. Card container
`--color-surface-elevated`, `1px --color-border`, `--radius-md`, `overflow:hidden`.

**Variants:**
- `scored` — meta row shows Score number (serif 19px, `--text-serif-sm` scaled)
  in score color + "/100" mono.
- `unscored` — meta row shows `★ {rating}` in mono `--color-neutral-200`.
- `with-actions` (default on touch surfaces) / `no-actions` (dense grids like
  calendar month plates).
- `compact` — no action bar, tighter padding (used in "Known for" and search
  people-adjacent rails).

**Type chip (top-left):** pill `rgb(16 14 12 / 0.6)`, 6px dot in
`--color-media-*`, mono `--text-micro` UPPERCASE label in `--color-text-primary`.

**Quick-action bar:** two buttons, `--radius-sm`, fill `rgb(237 231 220 / 0.06)`,
`1px --color-border`. Rate = `Star` + "Rate" (`--text-label`), full-width flex:1;
Bookmark = `Bookmark`, fixed 32px. On touch the whole 32px is the target padded
to 44px tap area.

**States:**
- default: as above.
- hover (desktop): card border → `--color-border-strong`; poster scales
  `1.02` (transform, `--transition-duration-base`); Rate button fill →
  `rgb(237 231 220 / 0.1)`.
- focus-visible: `--shadow-focus` on card.
- active (press): poster scale `0.99`.
- selected (multi-select in Library): 2px `--color-accent` inset ring + `Check`
  badge top-right.
- loading: skeleton variant (§13).
- rated (state after Rate): Rate button fill → `--color-accent-subtle`, label →
  `--color-accent`, icon `Star` filled.

---

## 3. List Card / Release Row  (`<ListRow>`)

Horizontal row used in Calendar Agenda, search "top result", where-to-watch,
and any dense list.

**Anatomy:** leading slot (date stack *or* 44px poster thumb *or* provider logo)
· body (title serif 15px + meta line: type label in `--color-media-*` · dot ·
mono meta) · trailing slot (action icon button *or* price pill).

**Dimensions:** min-height 60px; padding 11px 12px; `--color-surface-elevated`,
`1px --color-border`, `--radius-lg`; 13px gap between slots.

**States:** default / hover (border → strong) / focus-visible (`--shadow-focus`) /
active (bg → `--color-neutral-750`) / disabled. Trailing icon button follows §7.
Trailing icons: `BellPlus` (remind), `Play` (watch), `Plus` (add).

---

## 4. Horizontal Carousel / Rail  (`<Rail>`)

**Anatomy:** header row (serif section title `--text-serif-md` + optional "FOR
YOU" pill + trailing `ArrowRight` link) · scroller (CSS
`grid-auto-flow:column; grid-auto-columns:150px; gap:12px; overflow-x:auto`,
scrollbar hidden, `scroll-snap-type:x proximity`).

**Variants:** `poster-rail` (PosterCards), `people-rail` (avatar + name + role),
`chip-rail` (horizontally scrolling filter chips).

**States:** rail itself has no selected state; children own theirs. Desktop adds
`ChevronLeft`/`ChevronRight` overlay buttons on hover (fade in, `--transition-duration-base`);
hidden entirely under reduced-motion is NOT required — they stay, just no fade.
Scroll position must be keyboard reachable (roving tabindex on children).

---

## 5. Calendar  (`<ReleaseCalendar>`)

Two views, toggled by one control (see 05-DELTA §a — the Agenda view is an
introduced element). Toggle is a single pill button in the header replacing a
secondary icon.

**View toggle:** `--color-surface-elevated` pill, `--radius-lg`, icon + label.
Month view shows `List` icon + "List"; Agenda shows `CalendarDays` + "Month".

### 5a. Month grid
**Anatomy:** month stepper (`ChevronLeft` · month serif · `ChevronRight`) ·
weekday header (7× mono single letters, `--color-text-muted`) · week rows of 7
day cells.

**Day cell variants (aspect 1 : 1.42):**
- `empty` — just the day number, mono `--color-neutral-600`, centered top.
- `single` — poster plate: `--color-surface-elevated`, `--radius-md`, a 3px
  top border in the item's `--color-media-*`, day number chip top-left.
- `multi` — panel listing up to 2 items (3px×8px color bar + truncated mono
  title) then `+N` overflow in `--color-text-secondary`.

### 5b. Agenda (list) view
Grouped by "This week / Next week / <Month>". Each group: mono eyebrow label +
hairline rule, then `ListRow`s with a date stack leading slot and `BellPlus`
trailing.

**States:** today cell = 2px `--color-accent` ring. Selected day (if drill-in
added) = accent fill on the day number chip. Loading = skeleton grid (§13).

---

## 6. Filter & Sort Controls

### 6a. Type filter chips (`<TypeFilter>`)
Row of circular 40px icon chips: All (`Layers`), Games (`Gamepad2`), Movies
(`Clapperboard`), Shows (`Tv`).
- default: `1px --color-border-strong`, icon `--color-text-secondary`.
- selected: fill = `--color-accent` (for "All") or the media color for a single
  type; icon `--color-text-on-accent` / `--color-text-on-media`.
- hover: border → `--color-neutral-400`. focus-visible: ring. 44px tap area.

### 6b. Sort control (`<SortMenu>`)
Text + `ChevronDown`, mono `--text-meta`, `--color-text-secondary`; opens a menu
(§11 popover). **Discover default label = "Popularity"** (hard constraint).

### 6c. Segmented include/exclude (`<TriToggle>`) — Discover advanced filters
Two-segment pill inside `--color-surface-elevated`. "Include" selected =
`--color-accent` fill; "Exclude" selected = `--color-danger` fill; unselected
segment = `--color-text-secondary` text on transparent.

### 6d. Tag filter chip (`<TagChip>`)
- include: `--color-accent` fill, `Plus` icon, `--color-text-on-accent`.
- exclude: `1px` `--color-danger` border, `Minus` icon, `--color-danger` text.
- add: dashed `--color-border-strong`, `Plus`, `--color-text-secondary`.
- plain (navigational, e.g. related tags): `--color-surface-elevated`, `1px
  --color-border`, `--color-text-secondary`.

---

## 7. Buttons

Sizes (height / padding / text token / min tap):
- **lg** 44px / 0 16px / `--text-label-lg` / 44px
- **md** 38px / 0 16px / `--text-label` / 44px (pad tap area)
- **sm/inline** 30–32px / 0 12px / `--text-label` / 44px tap area
- **icon** 38×38 visible / 44×44 tap / `--radius-lg` (square) or `--radius-full`.

**Variants & tokens:**
- **primary:** fill `--color-accent`, text `--color-text-on-accent`. hover
  `--color-accent-hover`; active `--color-accent-active`; disabled per global.
- **secondary:** fill `--color-surface-elevated`, `1px --color-border-strong`,
  text `--color-text-primary`. hover border→`--color-neutral-400`; active bg→`--color-neutral-750`.
- **ghost:** transparent, text `--color-text-secondary`. hover bg
  `rgb(237 231 220 / 0.06)`, text → primary.
- **danger:** fill `--color-danger`, text `#100E0C`. hover `--color-danger-hover`.
- **loading:** label hidden, centered `Loader2` spinning (respect reduced-motion:
  swap to static `•••` or `aria-busy` text), button keeps width, `aria-busy="true"`.

Radius: pill (`--radius-full`) for primary CTAs & filter actions; `--radius-sm`
for inline card actions. Shape is per placement, documented per page.

---

## 8. Search Field  (`<SearchField>`)

**Anatomy:** leading `Search` icon · input · trailing `X` clear (when non-empty)
· optional "Cancel" text button (mobile, in-context).

Fill `--color-surface-elevated`, `--radius-lg`, height 44px, padding 0 14px,
placeholder `--color-text-secondary`, text `--color-text-primary`.

**States:**
- default: `1px --color-border`.
- focus/active: border `--color-accent` (0.45 alpha acceptable), caret
  `--color-accent`; `--shadow-focus` NOT added (border is the affordance) —
  except keyboard focus which still gets the ring for a11y.
- filled: shows `X` clear (44px tap).
- disabled / loading (results pending): trailing `Loader2`.

The global search entry routes to `/discover`.

---

## 9. Badges & Pills

- **Type label pill** — see §2 chip.
- **Eyebrow** — not a component, a text style: mono `--text-eyebrow` UPPERCASE,
  `--color-accent` (section eyebrows) or `--color-text-secondary`.
- **"FOR YOU" pill** — `--color-accent-subtle` fill, `--color-accent` text,
  mono `--text-micro`.
- **Count/price pill** — `--color-surface-elevated`, `1px --color-border`, mono.

### 9a. Fandex Score badge  (`<ScoreBadge>`)  — KEEP (existing element)
A 0–100 personal taste-match pill, colour-coded around a neutral baseline.

**Anatomy:** number (serif) + optional "/100" (mono, `--color-text-secondary`)
OR compact pill form on posters.

**Color logic (token):**
- score ≥ 80 → `--color-score-high` (`#5FE39A`)
- 65 ≤ score ≤ 79 → `--color-score-baseline` (`#CFC9BE`, the neutral baseline)
- score < 65 → `--color-score-low` (`#F0A04B`)

**Forms:**
- **inline** (card meta): number `--text-serif-sm`-ish (19px serif) + "/100".
- **pill-overlay** (poster corner): `rgb(16 14 12 / 0.66)` bg, `backdrop-filter:
  blur(5px)`, number in score color, `--radius-xs`.
- **hero** (detail page): number `--text-serif-2xl` in score color + a one-line
  explanation in `--color-text-secondary`.

**States:** static display element. `unrated` state (no personal score yet) →
show `—` in `--color-text-muted` with tooltip "Rate 5 titles to unlock". Never
animate the number.

---

## 10. Avatar  (`<Avatar>`)
Circle, `--radius-full`, `--color-surface-elevated`, `1px --color-border`.
Sizes: 34 (nav), 64 (cast/people rail), 84 (person facet header). Fallback:
`User` icon in `--color-text-muted` or initials in serif. Image via `next/image`.

---

## 11. Menu / Popover  (`<Menu>`)
Surface `--color-surface-overlay`, `--radius-lg`, `--shadow-lg`, `1px
--color-border`. Items 44px min, `--text-body-sm`; selected item `Check` +
`--color-accent`. Used by Sort, filters overflow, card overflow (`MoreVertical`).

## 12. Modal & Bottom Sheet  (`<Sheet>` / `<Modal>`)
- **Mobile: bottom sheet.** Surface `--color-surface-overlay`, top corners
  `--radius-xl`, `--shadow-sheet`, 36px grabber handle in `--color-neutral-600`.
  Enter: slide up `--transition-duration-slow`/`--ease-decelerate`. Scrim
  `rgb(0 0 0 / 0.6)`. Dismiss on scrim tap / swipe-down / `Escape`.
- **Desktop: centered modal.** max-width 480px, `--radius-xl`, `--shadow-lg`,
  scrim as above. Focus trapped; returns focus to invoker on close.
- Used for: Rate flow, filter sheet (mobile Discover), confirm-remove (danger),
  where-to-watch expand.

## 13. Skeleton / Loading  (`<Skeleton>`)
Base `--color-neutral-800`; shimmer sweep `--color-neutral-750` L→R, 1200ms
linear infinite. **Reduced-motion:** no shimmer — static `--color-neutral-800`
with `aria-busy`. Shapes mirror the real layout (poster 2:3 blocks, text bars at
`--radius-xs`). Rails show 4 skeleton cards; grids show 6; agenda shows 3 rows.

## 14. Empty State  (`<EmptyState>`)
Centered in an elevated panel: 40px rounded icon tile (`--color-accent-subtle`
bg, `--color-accent` glyph — e.g. `Sparkles`, `BookmarkX`, `CalendarOff`),
serif `--text-serif-md` line, `--text-body-sm` `--color-text-secondary`
support line, optional primary button. One per page, copy per page in 04.

## 15. Error State  (`<ErrorState>`)
Same frame as Empty but icon tile `--color-danger-subtle` / `--color-danger`
(`TriangleAlert`), serif line, muted support line, and a **secondary** "Try
again" button (`RefreshCw`). Never a dead end — always a retry or a route out.
Inline (per-rail) errors use a compact one-line variant with a `RotateCw` retry.
