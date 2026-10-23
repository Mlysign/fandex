import { describe, expect, it } from 'vitest';
// The router expo-router runs for (tabs)/_layout.tsx, without React Native.
import { TabRouter } from 'expo-router/build/react-navigation/routers/TabRouter';
import { browserLikeHistory, sameParams } from './tabHistory';

const NAMES = ['index', 'discover', '[type]/[slug]', 'open/[source]/[type]/[id]'];
const options = { routeNames: NAMES, routeParamList: {}, routeGetIdList: {} };

type Any = any;

function setup() {
  const original = TabRouter({ backBehavior: 'fullHistory' }) as Any;
  const router = { ...original, ...browserLikeHistory(original) };
  let state = router.getInitialState(options);
  const act = (type: string, name: string, params?: object) => {
    const next = router.getStateForAction(state, { type, payload: { name, params } }, options);
    if (next) state = next;
    return next;
  };
  const back = () => act('GO_BACK', '');
  const focused = () => {
    const r = state.routes[state.index];
    return r.params?.slug ? `${r.name}:${r.params.slug}` : r.name;
  };
  return { act, back, focused, length: () => state.history.length };
}

describe('Back history, kept as a browser keeps it', () => {
  it('Home, a title, Search, another title: Back is Search, then the first title, then Home (RV24)', () => {
    const t = setup();
    t.act('NAVIGATE', '[type]/[slug]', { type: 'game', slug: 'valheim' });
    t.act('NAVIGATE', 'discover');
    t.act('NAVIGATE', '[type]/[slug]', { type: 'game', slug: 'ocarina' });
    // Each step lengthens the history: that is what makes the web push an entry.
    expect(t.length()).toBe(4);
    t.back();
    expect(t.focused()).toBe('discover');
    t.back();
    expect(t.focused()).toBe('[type]/[slug]:valheim');
    t.back();
    expect(t.focused()).toBe('index');
    expect(t.back()).toBeNull();
  });

  it('a title opened from a title is a step of its own', () => {
    const t = setup();
    t.act('NAVIGATE', '[type]/[slug]', { type: 'game', slug: 'valheim' });
    t.act('NAVIGATE', '[type]/[slug]', { type: 'game', slug: 'ocarina' });
    expect(t.length()).toBe(3);
    t.back();
    expect(t.focused()).toBe('[type]/[slug]:valheim');
  });

  it('the same title again, or the tab you are on, adds nothing', () => {
    const t = setup();
    t.act('NAVIGATE', '[type]/[slug]', { type: 'game', slug: 'valheim' });
    t.act('NAVIGATE', '[type]/[slug]', { type: 'game', slug: 'valheim' });
    t.act('NAVIGATE', 'discover');
    t.act('NAVIGATE', 'discover');
    expect(t.length()).toBe(3);
  });

  it('the "Opening…" screen replaces itself: Back skips it (SM76)', () => {
    const t = setup();
    t.act('NAVIGATE', 'discover');
    t.act('NAVIGATE', 'open/[source]/[type]/[id]', { source: 'tmdb', type: 'movie', id: '603' });
    t.act('REPLACE', '[type]/[slug]', { type: 'movie', slug: 'the-matrix' });
    expect(t.length()).toBe(3);
    t.back();
    expect(t.focused()).toBe('discover');
    t.back();
    expect(t.focused()).toBe('index');
  });

  it('a replace by the same screen swaps its params in place', () => {
    const t = setup();
    t.act('NAVIGATE', '[type]/[slug]', { type: 'game', slug: 'valheim' });
    t.act('REPLACE', '[type]/[slug]', { type: 'game', slug: 'ocarina' });
    expect(t.length()).toBe(2);
    expect(t.focused()).toBe('[type]/[slug]:ocarina');
    t.back();
    expect(t.focused()).toBe('index');
  });
});

describe('sameParams', () => {
  it('compares by value, and an undefined key is an absent one', () => {
    expect(sameParams({ a: '1' }, { a: '1' })).toBe(true);
    expect(sameParams({ a: '1', b: undefined }, { a: '1' })).toBe(true);
    expect(sameParams(undefined, {})).toBe(true);
    expect(sameParams({ a: '1' }, { a: '2' })).toBe(false);
  });
});
