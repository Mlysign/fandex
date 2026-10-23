// Back history for the one navigator every screen is a tab of
// ((tabs)/_layout.tsx), kept the way a browser keeps it: every screen opened
// is one more step back.
//
// On the web expo-router writes the browser's history from this navigator's:
// a longer history pushes an entry, the same length replaces the current one
// (expo-router/build/fork/useLinking.js). So browser Back is only right when
// every screen opened adds an entry here (RV24):
//
// - backBehavior "history" keeps ONE entry per screen, and the item screen is
//   one screen for every title. Home → Valheim → Search → Ocarina moved
//   Valheim's entry to the end instead of adding one, the browser replaced
//   Search with Ocarina, and its Back went to Valheim. "fullHistory" keeps every
//   visit with the params it had, and Back puts those params back.
// - "fullHistory" still folds a visit into the one before when both are the
//   same screen, so a title opened from a title's rail replaced it. Here a
//   change of params on the focused screen is a step of its own.
// - expo-router's replace drops the wrong entry (it slices the history by the
//   route's position among ALL screens), so it only jumped and the screen that
//   replaced itself stayed in Back (SM76). Here it drops the screen it replaces.
//
// UNSTABLE_router must be pure: nothing here may read outside state.

import type { NavigationAction, ParamListBase, Router, TabNavigationState } from 'expo-router/react-navigation';

type State = TabNavigationState<ParamListBase>;
type Params = object | undefined;

/** Same params by value; a key set to undefined counts as absent. */
export function sameParams(a: Params, b: Params): boolean {
  if (a === b) return true;
  const x = (a ?? {}) as Record<string, unknown>;
  const y = (b ?? {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  for (const k of keys) if (!Object.is(x[k], y[k])) return false;
  return true;
}

export function browserLikeHistory<Action extends NavigationAction>(original: Router<State, Action>): Partial<Router<State, Action>> {
  return {
    getStateForAction(state, action, options) {
      if (action.type === 'REPLACE') {
        const jumped = original.getStateForAction(state, { ...action, type: 'JUMP_TO' }, options) as State | null;
        // A jump to another screen is appended after the one that asked to be
        // replaced; a jump to the same screen was already folded into it.
        if (!jumped?.history || jumped.history.length <= state.history.length) return jumped;
        const at = state.history.length - 1;
        return { ...jumped, history: [...jumped.history.slice(0, at), ...jumped.history.slice(at + 1)] };
      }

      const next = original.getStateForAction(state, action, options) as State | null;
      if (!next?.history || (action.type !== 'NAVIGATE' && action.type !== 'JUMP_TO')) return next;
      if (next.index !== state.index) return next;
      const was = state.routes[state.index];
      const now = next.routes[next.index];
      if (now.key !== was.key || sameParams(was.params, now.params)) return next;
      // The same screen with new params: keep the visit before as a step back,
      // with the params it showed (an entry made at startup carries none).
      const before = state.history.slice(0, -1);
      const last = state.history[state.history.length - 1];
      return {
        ...next,
        history: [
          ...before,
          ...(last ? [{ ...last, params: was.params }] : []),
          { type: 'route' as const, key: now.key, params: now.params },
        ],
      };
    },
  };
}
