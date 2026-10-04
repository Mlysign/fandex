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

  success: '#5FE39A',
  warning: '#F0A04B',
  danger: '#E5674C',

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

/** The type scale. Sizes are the handoff's, nudged up one step for a phone held at arm's length. */
export const type = {
  eyebrow: { fontFamily: font.mono, fontSize: 10, letterSpacing: 1.3, textTransform: 'uppercase', color: color.textSecondary },
  meta: { fontFamily: font.mono, fontSize: 11, lineHeight: 15, color: color.textSecondary },
  caption: { fontFamily: font.sans, fontSize: 12, lineHeight: 18, color: color.textSecondary },
  body: { fontFamily: font.sans, fontSize: 14, lineHeight: 22, color: color.textPrimary },
  label: { fontFamily: font.sansBold, fontSize: 12, color: color.textPrimary },
  title: { fontFamily: font.sansBold, fontSize: 15, lineHeight: 18, color: color.textPrimary },
  serifSm: { fontFamily: font.serif, fontSize: 17, lineHeight: 20, color: color.textPrimary },
  serifMd: { fontFamily: font.serif, fontSize: 22, lineHeight: 25, color: color.textPrimary },
  serifLg: { fontFamily: font.serif, fontSize: 28, lineHeight: 30, color: color.textPrimary },
} satisfies Record<string, TextStyle>;

export const TYPE_LABEL: Record<string, string> = { game: 'Game', movie: 'Film', show: 'Show' };
