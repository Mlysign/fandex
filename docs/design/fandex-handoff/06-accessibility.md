# 06 · Accessibility

Target: **WCAG 2.1 AA**. Ratios below are computed against the dark (default)
theme surfaces. "Normal" text needs ≥ 4.5:1; "large" (≥ 18.66px/24px+ or bold
≥ 14px) and non-text/UI need ≥ 3:1.

## Contrast — text on surfaces

Surfaces: `--color-surface` `#100E0C`, `--color-surface-elevated` `#181512`.

| Foreground | Hex | on `#100E0C` | on `#181512` | Verdict |
|---|---|---|---|---|
| text-primary | `#EDE7DC` | **15.6:1** | **14.8:1** | Pass AA all sizes |
| text-secondary | `#9A8F80` | **6.07:1** | **5.74:1** | Pass AA normal |
| neutral-400 | `#8A8175` | **5.02:1** | **4.75:1** | Pass AA normal (min for small text) |
| text-muted | `#6F665A` | **3.42:1** | **3.24:1** | ⚠ Large / non-text only — FAILS normal |
| accent | `#C8A24B` | **8.0:1** | **7.6:1** | Pass AA all sizes |
| success / score-high | `#5FE39A` | **11.9:1** | **11.2:1** | Pass |
| warning / score-low | `#F0A04B` | **9.0:1** | **8.5:1** | Pass |
| danger | `#E5674C` | **5.85:1** | **5.55:1** | Pass AA normal |
| score-baseline | `#CFC9BE` | **11.8:1** | **11.1:1** | Pass |
| media-game | `#4ade80` | **11.1:1** | **10.4:1** | Pass |
| media-movie | `#f59e0b` | **9.0:1** | **8.5:1** | Pass |
| media-show | `#a78bfa` | **7.1:1** | **6.7:1** | Pass |
| text-on-accent `#100E0C` on accent `#C8A24B` | — | **8.0:1** | — | Pass (dark text on gold) |

### Required rules from the above
- **`--color-text-muted` (`#6F665A`) must not be used for normal-size body
  text.** It is legitimate only for: text ≥ 18.66px, decorative day-numbers,
  disabled elements, and non-text glyphs. **The mono nav micro-labels (8px) and
  8–10px metadata must use `--color-neutral-400` (`#8A8175`) or lighter**, never
  `#6F665A`. Where the 2a mockups used `#6F665A` for tiny inactive labels, bump
  to `#8A8175`. (Inactive nav *icons* at 20px are non-text UI → 3:1 is enough, so
  the icon may stay muted; the text label may not.)
- Media colors are used as small dots and short UPPERCASE labels; all pass ≥ 3:1
  comfortably even at micro sizes, but do not set body copy in them.
- **Never encode meaning by color alone.** Media type always pairs the color dot
  with a text label; the Score badge pairs color with the number; include/exclude
  filters pair color with a `Plus`/`Minus` icon.

## Focus-visible
- Treatment: `--shadow-focus` = `0 0 0 2px #100E0C, 0 0 0 4px #C8A24B` (2px
  surface gap, then 2px gold ring). Ring vs surface = accent 8:1 → passes the
  3:1 non-text requirement.
- Use `:focus-visible` only (no ring on mouse press). Applies to every
  interactive element incl. cards, chips, nav items, sheet controls.
- Focus order follows DOM order; rails use roving `tabindex` so a rail is one
  tab stop and arrow keys move within.
- Modals/sheets trap focus and restore it to the invoker on close (`Escape`
  closes).

## Touch targets
- Minimum **44×44px** (`--size-touch-min`) for all interactive elements on
  mobile. Visible glyphs may be smaller (e.g. 32px card bookmark, 20px nav icon)
  but the hit area is padded to 44px.
- Spacing between adjacent targets ≥ 8px to avoid mis-taps (filter chip row uses
  8px gap).

## Reduced motion  (`@media (prefers-reduced-motion: reduce)`)
- Skeleton shimmer → static `--color-neutral-800` fill (no sweep).
- Poster hover scale, card press scale, carousel chevron fade → removed;
  color/opacity changes only.
- Sheet/modal slide → cross-fade in place at `--duration-fast`.
- Loading spinners (`Loader2`) → replace spin with `aria-busy` + static glyph.
- No auto-advancing carousels exist, so nothing to disable there.

## Adaptive nav — screen reader behaviour
The nav is ONE component rendering different layouts by breakpoint. It must be
**one consistent landmark** regardless of layout so SR users get a stable model.

- Wrap in `<nav aria-label="Primary">`. Do not render two navs; re-layout the
  same list.
- Items are a list of links; the current route carries `aria-current="page"`
  (announced "current page"). The visual accent state is mirrored, not replaced,
  by this attribute.
- Each item has an accessible name = its visible text label ("Home", "Discover"…)
  even when the label is visually a micro mono caption. Icons are decorative
  (`aria-hidden="true"`); the link text is the name.
- **Mobile (bottom bar):** it is a fixed landmark at the end of the DOM but
  should be reachable; keep it after `<main>` in source order so content comes
  first, and ensure it is not obscured by the browser chrome (respect
  `env(safe-area-inset-bottom)`). Announce as "Primary, navigation".
- **Desktop (top bar):** same `<nav aria-label="Primary">`, placed before
  `<main>` in source order (it is a masthead). The search field in the trailing
  slot is a separate `role="search"` landmark with its own label.
- The breakpoint switch must not change the accessible name, roles, or item
  order — only CSS layout. A resize must never move focus.
- Provide a visible **"Skip to content"** link as the first focusable element,
  targeting `<main id="main">`.

## Forms & controls
- Search field: `<input type="search">` with an associated `<label>` (visually
  hidden is fine) or `aria-label="Search Fandex"`; the clear button is a real
  `<button aria-label="Clear search">`.
- Tri-state include/exclude and type filters expose state via
  `aria-pressed`/`aria-checked` and a text label, not color alone.
- The Score badge exposes a full text alternative, e.g.
  `aria-label="Fandex Score 91 out of 100 — strong match"`, since the number +
  color alone is not sufficient for the "match strength" meaning.
