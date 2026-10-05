// A provider or store, drawn as its own mark in the page's text colour. Never
// in the brand's colour: a provider is identified by its logo, not its hue
// (the site's rule since 2026-08-18). The paths are the site's, generated into
// src/lib/brandMarks.ts.

import { Globe } from 'lucide-react-native';
import Svg, { Path } from 'react-native-svg';
import { BRAND_MARKS } from '@/lib/brandMarks';
import { color } from '~/theme';

const MARK_BY_SOURCE: Record<string, string> = {
  steam: 'Steam', trakt: 'Trakt', tmdb: 'TMDB', igdb: 'IGDB', imdb: 'IMDb', gog: 'GOG',
  epic: 'Epic Games', itch: 'itch.io', reddit: 'Reddit', discord: 'Discord', wikipedia: 'Wikipedia',
};

export function hasBrandMark(source: string): boolean {
  return !!BRAND_MARKS[MARK_BY_SOURCE[source] ?? source];
}

export function BrandGlyph({ source, size = 14, tint = color.textSecondary }: {
  /** A lowercase provider id, or a store's display name. */
  source: string;
  size?: number;
  tint?: string;
}) {
  const mark = BRAND_MARKS[MARK_BY_SOURCE[source] ?? source];
  if (!mark) return <Globe size={size} color={tint} />;
  return (
    <Svg viewBox="0 0 24 24" width={size} height={size}>
      <Path d={mark.path} fill={tint} />
    </Svg>
  );
}
