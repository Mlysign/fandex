// Hardcover on the Worker: the secret and the switch handed to the shared
// module, and the one gate every Hardcover call goes through.
//
// Hardcover's free plan allows 5,000 requests a day (docs.hardcover.app,
// 2026-10-17), shared by every route here and counted per top-level query
// field. `hardcoverHalf` spends that budget in `daily_budget` before a call
// (one D1 row write per call, the price of being able to say no), and answers
// nothing instead of failing when the day's allowance is gone, when Hardcover
// is off, or when it errs: a book route is Open Library's, and Hardcover only
// ever adds to it.

import { hardcoverConfigured, setHardcoverEnv } from "@/lib/sources/hardcover";
import type { BookCard } from "@/lib/sources/bookPure";
import { capFrom, spend } from "./budget";
import type { Env } from "./env";

/** Under their 5,000: a token that expired at midnight and a retry or two must not spend the day. */
export const DEFAULT_HARDCOVER_DAILY_CAP = 4000;

/** Point the shared module at this Worker's secret and switch. Cheap; called on any path that may reach Hardcover. */
export function useHardcover(env: Env): void {
  setHardcoverEnv(() => ({ token: env.HARDCOVER_TOKEN, enabled: env.HARDCOVER_ENABLED, coverOrigin: env.COVER_ORIGIN }));
}

/**
 * Hardcover's half of a books answer. `units` is how many requests `load`
 * makes (a series rail is two). Empty when Hardcover is off, over budget, or
 * failing; a failure is logged and never a 502, since the Open Library half
 * still answers.
 */
export async function hardcoverHalf(env: Env, kind: string, units: number, load: () => Promise<BookCard[]>): Promise<BookCard[]> {
  useHardcover(env);
  if (!hardcoverConfigured()) return [];
  if (!(await spend(env.DB, "hardcover", capFrom(env.HARDCOVER_DAILY_CAP, DEFAULT_HARDCOVER_DAILY_CAP), units))) {
    console.warn("hardcover_budget", { kind });
    return [];
  }
  try {
    return await load();
  } catch (e) {
    console.warn("hardcover_failed", { kind, error: e instanceof Error ? e.message : String(e) });
    return [];
  }
}
