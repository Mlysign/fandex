// How a pressable thing answers a finger: it sinks a little while held, springs
// back if the touch turns into a scroll, and pops once if it was a tap. Shared
// by cards, people, the tab bar and Up next's tick. The haptics that go with
// them are lib/feel.ts's; these sizes live here so the website can render a
// card without reaching expo.
//
// ⚠️ Only react-native here: components/cardFace.tsx uses this, and the
// website's server render imports that file (no expo, no router).

import { useRef } from 'react';
import { Animated, Easing, Platform } from 'react-native';

const NATIVE = Platform.OS !== 'web';

export interface PressFeel {
  /** How far it sinks under the finger. */
  down: number;
  /** How far a tap throws it past 1 before it settles. */
  pop: number;
}

/** Big things barely move; small targets move more, or nobody sees it. */
export const PRESS = {
  card: { down: 0.96, pop: 1.025 },
  person: { down: 0.92, pop: 1.06 },
  tab: { down: 0.8, pop: 1.2 },
  tick: { down: 0.85, pop: 1.3 },
} satisfies Record<string, PressFeel>;

/**
 * The sink is eased in over 140 ms rather than snapped: a touch that turns
 * into a scroll in its first few frames shows almost none of it, so scrolling
 * a rail does not make the cards flicker. The pop runs on the tap itself and
 * never delays what the tap does.
 */
export function usePressScale({ down, pop }: PressFeel) {
  const scale = useRef(new Animated.Value(1)).current;
  return {
    scale,
    onPressIn: () => {
      Animated.timing(scale, { toValue: down, duration: 140, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE }).start();
    },
    /** Back to rest. After a tap `pop` takes over at once; after a scroll this is the whole answer. */
    onPressOut: () => {
      Animated.spring(scale, { toValue: 1, friction: 7, tension: 160, useNativeDriver: NATIVE }).start();
    },
    pop: () => {
      Animated.sequence([
        Animated.timing(scale, { toValue: pop, duration: 90, easing: Easing.out(Easing.quad), useNativeDriver: NATIVE }),
        Animated.spring(scale, { toValue: 1, friction: 4.5, tension: 170, useNativeDriver: NATIVE }),
      ]).start();
    },
  };
}
