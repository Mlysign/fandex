// Every number that decides how rating and saving FEEL, in one place, and the
// haptic patterns built from them. The native side is
// modules/fandex-haptics (a port of the Bubblewrap game's Haptics.kt).
//
// What came over from Bubblewrap, each one earned there on a device:
//  - A haptic is a sharp CLICK with a softer TICK about 34 ms behind it. The
//    tail is what turns a bump into a pop. Never a 50 ms buzz.
//  - One pulse per event, scaled by how big the event is. Never one per star:
//    ten separate pulses are mush.
//  - Anticipation on touch DOWN (the thing under the finger dips or lifts at
//    once), the payoff on release.
//  - Invented effect sizes land about half as strong as wanted, so these start
//    at roughly twice instinct. That rule never reaches latency: feedback starts
//    on the touch, with no delay of any kind.
//  - A low rating still gets a clean pop; the celebration grows with the number.

import { requireOptionalNativeModule } from 'expo';

interface HapticsNative {
  tier(): string;
  play(kinds: number[], scales: number[], delays: number[]): void;
}

const native = requireOptionalNativeModule<HapticsNative>('FandexHaptics');

const CLICK = 0;
const TICK = 1;
type Pulse = [kind: number, scale: number, delayMs: number];

function play(pulses: Pulse[]) {
  if (!native) return;
  try {
    native.play(pulses.map((p) => p[0]), pulses.map((p) => p[1]), pulses.map((p) => p[2]));
  } catch {
    // A haptic that fails is a missing nicety, never an error to show.
  }
}

/** Which haptic path fires on this phone: "composition" is the good one. */
export const hapticTier = (): string => native?.tier() ?? 'none';

export const FEEL = {
  /** Bubblewrap's tail: a softer tick this long after the click, at this share of its strength. */
  tailDelayMs: 34,
  tailScale: 0.9,

  // ── The stars ──
  /** The tick as the finger crosses onto a new star, like a detent. */
  detent: 0.5,
  /** How big the star under the finger grows while held (Bubblewrap's number swell, 1.34). */
  holdScale: 1.4,
  holdMs: 90,
  /** The pop on release: up to this, then a spring back. */
  popScale: 1.9,
  popUpMs: 110,
  /** The ring thrown from the picked star: from this size to that, over this long. */
  ringFrom: 0.55,
  ringTo: 2.6,
  ringMs: 420,
  /** Sparks out of the picked star: how many at each tier, how far, how long. */
  sparks: { low: 0, mid: 6, high: 10, top: 16 },
  sparkReach: 44,
  sparkMs: 560,
  /** An 8 or more sends a wave along the lit stars, this far apart. */
  waveStaggerMs: 32,
  waveScale: 1.45,
  /** The readout's swell each time the number under the finger changes. */
  readoutSwell: 1.35,
  /** How long the picker stays open after a pick, so the pop is seen. Not input latency: the rating is already saved. */
  settleMs: { clear: 260, low: 420, mid: 520, high: 700, top: 950 },

  // ── Save (the bookmark) ──
  /** The press-in dip, then the pop when it turns on. Subtler than a rating on purpose. */
  savePress: 0.82,
  savePop: 1.4,
  saveClick: 0.55,
  unsaveTick: 0.4,
} as const;

export type RatingTier = 'clear' | 'low' | 'mid' | 'high' | 'top';

/** How much celebration a rating earns: a pop for any, sparks from 5, a wave from 8, everything at 10. */
export function ratingTier(n: number | null): RatingTier {
  if (n == null) return 'clear';
  if (n >= 10) return 'top';
  if (n >= 8) return 'high';
  if (n >= 5) return 'mid';
  return 'low';
}

/** The pulses a rating plays. Exported for the test; `haptics.rate` plays them. */
export function ratingPulses(n: number | null): Pulse[] {
  const t = FEEL.tailDelayMs;
  const tail = FEEL.tailScale;
  if (n == null) return [[TICK, 0.5, 0]];
  // 1 is 0.46, 10 is 1: strength climbs with the number, as Bubblewrap's grows with a wave.
  const s = Math.min(1, 0.4 + 0.06 * n);
  const tier = ratingTier(n);
  if (tier === 'top') {
    // Three rising waves in time with the visual one, then the tail.
    return [[CLICK, 0.7, 0], [CLICK, 0.85, 90], [CLICK, 1, 90], [TICK, tail, t]];
  }
  if (tier === 'high') return [[CLICK, s * 0.8, 0], [CLICK, s, 90], [TICK, s * tail, t]];
  return [[CLICK, s, 0], [TICK, s * tail, t]];
}

export const haptics = {
  /** The finger moved onto another star. */
  detent: () => play([[TICK, FEEL.detent, 0]]),
  /** A rating was picked (null: the rating was taken away). */
  rate: (n: number | null) => play(ratingPulses(n)),
  /** Save turned on: a small click with its tail. Off: one soft tick. */
  save: (on: boolean) => play(on
    ? [[CLICK, FEEL.saveClick, 0], [TICK, FEEL.saveClick * FEEL.tailScale, FEEL.tailDelayMs]]
    : [[TICK, FEEL.unsaveTick, 0]]),
};
