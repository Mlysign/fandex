// The design system, "Ticket · Calm" (docs/design/fandex-handoff/02-tokens.json),
// as React Native values. One dark theme: the site never wired a light one.
//
// These are the handoff's numbers, not new ones. If a value here and the token
// file disagree, the token file is right.

import type { TextStyle } from 'react-native';

export const color = {
  surface: '#100E0C',
  surfaceElevated: '#181512',
  surfaceOverlay: '#201C18',
  surfaceInset: '#0B0A08',

  border: 'rgba(237,231,220,0.09)',
  borderStrong: 'rgba(237,231,220,0.14)',

  textPrimary: '#EDE7DC',
  textSecondary: '#9A8F80',
  textMuted: '#6F665A',
  textOnAccent: '#100E0C',

  accent: '#C8A24B',
  accentSubtle: 'rgba(200,162,75,0.14)',

  accentHover: '#D4B063',

  success: '#5FE39A',
  warning: '#F0A04B',
  danger: '#E5674C',
  successSubtle: 'rgba(95,227,154,0.14)',
  dangerSubtle: 'rgba(229,103,76,0.14)',

  // The neutral ramp's named steps, where the site reaches for one directly.
  neutral400: '#8A8175',
  neutral600: '#3A342E',
  neutral700: '#2A2521',
  neutral800: '#181512',

  // The Fandex Score's three bands (src/components/FandexScoreBadge.tsx): a
  // strong match is green, a weak one ORANGE, never red. Red means an error.
  scoreHigh: '#5FE39A',
  scoreBaseline: '#CFC9BE',
  scoreLow: '#F0A04B',

  // The quick-action buttons' idle fill and border (globals.css, --fill-idle).
  fillIdle: 'rgba(237,231,220,0.06)',
  fillIdleBorder: 'rgba(237,231,220,0.07)',
  // What sits over artwork: the type chip, a hover label.
  scrimChip: 'rgba(16,14,12,0.62)',

  // What a chip is about, the site's four facet colours (src/lib/facetPalette.ts).
  facet: { person: '#E0B15C', genre: '#C8A24B', tag: '#AC9A72', company: '#C08152' },

  // The media-type axis. Not brand colours: a type, not a provider.
  media: { game: '#4ade80', movie: '#f59e0b', show: '#a78bfa' } as Record<string, string>,
} as const;

export const space = { hairline: 1, xxs: 2, xs: 6, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, section: 44 } as const;
export const radius = { xs: 4, sm: 7, md: 10, lg: 12, xl: 16, full: 999 } as const;

export const font = {
  serif: 'DMSerifDisplay_400Regular',
  sans: 'SpaceGrotesk_400Regular',
  sansBold: 'SpaceGrotesk_600SemiBold',
  mono: 'SpaceMono_400Regular',
} as const;

/**
 * The type scale: the site's own (src/app/globals.css, --text-*), size for size.
 * It was one step larger here until 2026-10-10, which was part of why the app
 * read as a different product. A line-height of 1 on the web is written here
 * as the size plus two, so a descender is not clipped on Android.
 */
export const type = {
  eyebrow: { fontFamily: font.mono, fontSize: 9, lineHeight: 11, letterSpacing: 1.17, textTransform: 'uppercase', color: color.textSecondary },
  micro: { fontFamily: font.mono, fontSize: 8, lineHeight: 10, letterSpacing: 0.48, textTransform: 'uppercase', color: color.textSecondary },
  meta: { fontFamily: font.mono, fontSize: 10, lineHeight: 14, color: color.textSecondary },
  caption: { fontFamily: font.sans, fontSize: 11, lineHeight: 16.5, color: color.textSecondary },
  bodySm: { fontFamily: font.sans, fontSize: 12, lineHeight: 18.6, color: color.textSecondary },
  body: { fontFamily: font.sans, fontSize: 13, lineHeight: 20.8, color: color.textPrimary },
  label: { fontFamily: font.sansBold, fontSize: 11, lineHeight: 13, color: color.textPrimary },
  labelLg: { fontFamily: font.sansBold, fontSize: 12.5, lineHeight: 15, color: color.textPrimary },
  title: { fontFamily: font.sansBold, fontSize: 15, lineHeight: 17, color: color.textPrimary },
  serifSm: { fontFamily: font.serif, fontSize: 15, lineHeight: 17, color: color.textPrimary },
  serifMd: { fontFamily: font.serif, fontSize: 21, lineHeight: 23, color: color.textPrimary },
  serifLg: { fontFamily: font.serif, fontSize: 26, lineHeight: 27, color: color.textPrimary },
  serifXl: { fontFamily: font.serif, fontSize: 30, lineHeight: 31, color: color.textPrimary },
  serif2xl: { fontFamily: font.serif, fontSize: 34, lineHeight: 35, color: color.textPrimary },
} satisfies Record<string, TextStyle>;

/** Where the layout changes, as on the site: the nav flips at 768, filters open out at 1024. */
export const breakpoint = { sm: 640, md: 768, lg: 1024, xl: 1280 } as const;
/** The two nav bars' heights (globals.css, --size-nav-bar-*). */
export const navHeight = { bottom: 53, top: 56 } as const;

// The site's words: a film is a "movie" there, on every chip and card.
export const TYPE_LABEL: Record<string, string> = { game: 'Game', movie: 'Movie', show: 'Show' };
export const TYPE_PLURAL: Record<string, string> = { game: 'Games', movie: 'Movies', show: 'Shows' };
