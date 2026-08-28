import { describe, it, expect, beforeEach } from "vitest";
import { initDb, run, query, get } from "./db";
import { upsertMediaItem } from "./matcher";
import { PROJECTION_VERSION } from "./sources/project";
import { fillCandidates } from "./catalogFill";
import {
  retentionSweep, retentionStatus, RETENTION_MAX_AGE_S, RETENTION_LEAD_S,
} from "./retention";

// 2026-08-28 — TMDB's API Terms of Use §1.C cap caching at SIX MONTHS. Nothing
// in this codebase enforced that, and nothing would have: `healLinks` re-fetches
// a link whose PROJECTION VERSION is behind, never one that is merely old, so an
// item's `last_synced` stops moving the moment it heals.
//
// Measured the day this was written: the oldest tmdb link was 2026-06-05, so the
// first breach would have landed silently around 2026-12-05 — not because
// anything was working, but because the app had not existed for six months.
//
// What these pin is the contract, not the plumbing: a link inside the lead
// window gets QUEUED, a fresh one is left alone, the queue is the one the fill
// job already drains, and `expired` reports a breach rather than hiding it.

initDb();

const MOVIE = "movie" as const;
const now = () => Math.floor(Date.now() / 1000);
const DAY = 86400;

const tmdbPayload = (id: number) => ({
  id, title: `Aged ${id}`, release_date: "2020-01-01", overview: "o",
  credits: { crew: [{ job: "Director", name: "Greta Gerwig" }], cast: [] },
  genres: [{ id: 1, name: "Drama" }],
});

/** An item with one link of `source`, `ageDays` old and fully projected. */
function aged(n: number, source: "tmdb" | "steam", ageDays: number) {
  const id = upsertMediaItem({
    source, sourceId: `ret${n}`, type: MOVIE, title: `Aged ${n}`,
    releaseDate: "2020-01-01", rawData: tmdbPayload(9000 + n),
  });
  run(
    `UPDATE media_links SET last_synced = ?, projection_version = ?
      WHERE media_item_id = ? AND source = ?`,
    [now() - ageDays * DAY, PROJECTION_VERSION, id, source]
  );
  return id;
}

const versionOf = (itemId: string) =>
  get<{ v: number }>(`SELECT projection_version v FROM media_links WHERE media_item_id = ?`, [itemId])?.v;

beforeEach(() => {
  run("DELETE FROM media_items");
});

describe("provider data retention", () => {
  it("caps tmdb at the six months its terms state", () => {
    // The number is a CONTRACT, not a tuning knob — if this changes, the terms
    // were re-read, or somebody guessed.
    expect(RETENTION_MAX_AGE_S.tmdb).toBe(6 * 30 * DAY);
  });

  it("queues a link inside the lead window and leaves a fresh one alone", () => {
    const old = aged(1, "tmdb", 160);  // ~5.3 months: inside the lead window
    const fresh = aged(2, "tmdb", 30);
    expect(retentionSweep().marked).toBe(1);
    expect(versionOf(old)).toBe(0);
    expect(versionOf(fresh)).toBe(PROJECTION_VERSION);
  });

  it("leaves a link with no stated cap alone, however old", () => {
    // Steam's Web API terms contemplate storage and set no retention limit, so
    // ageing a steam link is not a breach and must not spend a provider call.
    const s = aged(3, "steam", 900);
    expect(retentionSweep().marked).toBe(0);
    expect(versionOf(s)).toBe(PROJECTION_VERSION);
  });

  it("hands the queued link to the job that already drains it", () => {
    // The whole design: retention adds one UPDATE and reuses the existing fetch,
    // pacing and budget path instead of standing up a second one.
    const old = aged(4, "tmdb", 170);
    expect(fillCandidates(50).map((c) => c.id)).not.toContain(old);
    retentionSweep();
    expect(fillCandidates(50).map((c) => c.id)).toContain(old);
  });

  it("does not touch raw_data, so nothing degrades while it waits", () => {
    // Marking is a queue, not a deletion: facets, scores and pages must read
    // exactly as before until the refresh actually lands.
    const old = aged(5, "tmdb", 170);
    const before = get<{ raw_data: string }>(`SELECT raw_data FROM media_links WHERE media_item_id = ?`, [old]);
    retentionSweep();
    const after = get<{ raw_data: string }>(`SELECT raw_data FROM media_links WHERE media_item_id = ?`, [old]);
    expect(after!.raw_data).toBe(before!.raw_data);
  });

  it("is idempotent — a second pass does not re-queue the same rows", () => {
    // Otherwise every tick inflates the fill backlog with rows already in it.
    aged(6, "tmdb", 170);
    aged(7, "tmdb", 175);
    expect(retentionSweep().marked).toBe(2);
    expect(retentionSweep().marked).toBe(0);
  });

  it("respects its batch, so a backlog drains over ticks", () => {
    for (let i = 10; i < 15; i++) aged(i, "tmdb", 170 + i);
    expect(retentionSweep(2).marked).toBe(2);
    expect(retentionSweep(2).marked).toBe(2);
    expect(retentionSweep(2).marked).toBe(1);
    expect(retentionSweep(2).marked).toBe(0);
  });

  it("takes the oldest first, which is the one closest to breaching", () => {
    aged(20, "tmdb", 165);
    const oldest = aged(21, "tmdb", 179);
    retentionSweep(1);
    expect(versionOf(oldest)).toBe(0);
  });

  it("reports a breach as expired rather than hiding it", () => {
    aged(30, "tmdb", 200); // past six months
    const s = retentionStatus();
    expect(s.expired).toBe(1);
    expect(s.due).toBe(1);          // an expired link is also due
    expect(s.oldestDays.tmdb).toBe(200);
  });

  it("reports zero expired for a catalog inside the cap", () => {
    aged(31, "tmdb", 100);
    expect(retentionStatus().expired).toBe(0);
    expect(retentionStatus().due).toBe(0);
  });

  it("leaves a month of slack between queueing and breaching", () => {
    // The lead is not padding: it is the window in which the fill job drains,
    // a provider outage passes, and a title TMDB now 404s gets noticed while it
    // is still legal to hold.
    expect(RETENTION_LEAD_S).toBe(30 * DAY);
    const cap = RETENTION_MAX_AGE_S.tmdb!;
    const queuedAt = cap - RETENTION_LEAD_S;
    expect(cap - queuedAt).toBe(30 * DAY);
  });

  it("enforces nothing for igdb, which is the honest state", () => {
    // The Twitch Developer Services Agreement allows a 24-hour cache or prior
    // written authorization; IGDB's own product ships webhooks whose only
    // purpose is keeping your copy current. That contradiction needs an answer
    // from IGDB, not a number picked here.
    expect(RETENTION_MAX_AGE_S.igdb).toBeUndefined();
  });
});
