// The Fandex mark, its outline, and the three media-type glyphs. Ports of the
// site's Logo.tsx, LogoOutline.tsx and Badges.tsx (TypeIcon), drawn with
// react-native-svg from the same paths.

import { useId } from 'react';
import Svg, { Circle, G, Line, Mask, Path, Polyline, Rect } from 'react-native-svg';
import { color } from '~/theme';

/** Two stacked cards: a violet one tilted behind a gold one. */
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 26 26">
      <Rect x="0" y="5" width="18" height="20" rx="4" fill={color.media.show} transform="rotate(-9 9 15)" />
      <Rect x="7" y="2" width="18" height="20" rx="4" fill={color.accent} stroke={color.surface} strokeWidth="1" />
    </Svg>
  );
}

const BOX = 16;
const VIEWBOX = 26;
// A lucide icon is drawn with a 2px stroke on a 24 grid. This is that weight on the logo's 26 grid.
const STROKE = Number(((((2 * BOX) / 24) * VIEWBOX) / BOX).toFixed(2));

/** The mark as an outline, the weight of the icons it sits beside: the "all types" glyph. */
export function LogoOutline({ size = BOX, tint = color.textSecondary }: { size?: number; tint?: string }) {
  const maskId = `fx-logo-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <Svg
      width={size} height={size} viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
      fill="none" stroke={tint} strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round">
      {/* The back card, with the front card's footprint cut out of it. */}
      <Mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width={VIEWBOX} height={VIEWBOX}>
        <Rect width={VIEWBOX} height={VIEWBOX} fill="white" stroke="none" />
        <Rect x="9.5" y="4" width="14.5" height="17" rx="3" fill="black" stroke="black" strokeWidth={STROKE * 2} />
      </Mask>
      <G mask={`url(#${maskId})`}>
        <Rect x="2.5" y="6" width="14.5" height="17" rx="3" transform="rotate(-9 9.75 14.5)" />
      </G>
      <Rect x="9.5" y="4" width="14.5" height="17" rx="3" />
    </Svg>
  );
}

/** The site's own game, movie and show glyphs. Used where there is no artwork. */
export function TypeIcon({ type, size = 12, tint = color.textMuted }: { type: string; size?: number; tint?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={tint} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {type === 'game' ? (
        <>
          <Rect x="2" y="7" width="20" height="10" rx="5" />
          <Line x1="6.5" y1="12" x2="9.5" y2="12" />
          <Line x1="8" y1="10.5" x2="8" y2="13.5" />
          <Circle cx="15.5" cy="11" r="0.6" />
          <Circle cx="17.5" cy="13" r="0.6" />
        </>
      ) : type === 'movie' ? (
        <>
          <Rect x="3" y="8" width="18" height="12" rx="1" />
          <Path d="M3 8l3.2-4M9 8l3.2-4M15 8l3.2-4" />
        </>
      ) : type === 'show' ? (
        <>
          <Rect x="3" y="7" width="18" height="12" rx="2" />
          <Polyline points="8 3 12 7 16 3" />
        </>
      ) : (
        <Circle cx="12" cy="12" r="9" />
      )}
    </Svg>
  );
}
