import { beforeEach, describe, expect, it } from "vitest";
import { BIN_COUNT, parseScoreReports, saveScoreReports, SCORE_VERSION, scoreSummary } from "../src/scoreReport";
import { count, db, wipe } from "./helpers";

beforeEach(wipe);

const bins = (at: Record<number, number>) => Array.from({ length: BIN_COUNT }, (_, i) => at[i] ?? 0);
const report = (medium: string, over: Partial<{ rated: number; bins: number[]; labels: Record<string, [number, number]> }> = {}) => ({
  medium, rated: 10, bins: bins({ 5: 3, 6: 5, 7: 2 }), labels: { "sure-thing": [4, 3], usual: [6, 2] } as Record<string, [number, number]>, ...over,
});

async function user(id: string) {
  await db.prepare("INSERT INTO users (id) VALUES (?)").bind(id).run();
}

describe("a score report", () => {
  it("is counts in a fixed shape, or a refusal", () => {
    expect(parseScoreReports({ reports: [report("movie")] })).toHaveLength(1);
    expect(() => parseScoreReports({ reports: [report("podcast")] })).toThrow("Unknown medium");
    expect(() => parseScoreReports({ reports: [report("movie"), report("movie")] })).toThrow("One report per medium");
    expect(() => parseScoreReports({ reports: [report("movie", { bins: [1, 2] })] })).toThrow("counts");
    expect(() => parseScoreReports({ reports: [report("movie", { bins: bins({ 0: 11 }) })] })).toThrow("more than rated");
    expect(() => parseScoreReports({ reports: [report("movie", { labels: { "sure-thing": [3, 4] } })] })).toThrow("cannot count more");
    expect(() => parseScoreReports({ reports: [report("movie", { labels: { hot: [1, 1] } })] })).toThrow("Unknown label");
    expect(() => parseScoreReports({ reports: [report("movie", { rated: 2.5 })] })).toThrow("whole number");
  });

  it("is one row per medium per user, replaced on the next send", async () => {
    await user("u1");
    await saveScoreReports(db, "u1", parseScoreReports({ reports: [report("movie"), report("game", { rated: 4, bins: bins({ 6: 4 }), labels: { usual: [4, 4] } })] }));
    expect(await count("score_report")).toBe(2);
    await saveScoreReports(db, "u1", parseScoreReports({ reports: [report("movie", { rated: 12, bins: bins({ 6: 12 }), labels: { usual: [12, 6] } })] }));
    expect(await count("score_report")).toBe(2);
    const row = await db.prepare("SELECT rated, version FROM score_report WHERE user_id = 'u1' AND medium = 'movie'").first<{ rated: number; version: number }>();
    expect(row).toEqual({ rated: 12, version: SCORE_VERSION });
  });

  it("sums over everybody, per medium and in all, and leaves another version's rows out", async () => {
    await user("u1");
    await user("u2");
    await saveScoreReports(db, "u1", [report("movie")]);
    await saveScoreReports(db, "u2", [report("movie", { rated: 20, bins: bins({ 6: 20 }), labels: { "sure-thing": [10, 9] } }), report("game", { rated: 3, bins: bins({ 7: 3 }), labels: { bycatch: [3, 0] } })]);
    await db.prepare("UPDATE score_report SET version = 1 WHERE user_id = 'u2' AND medium = 'game'").run();
    const s = await scoreSummary(db);
    const movie = s.media.find((m) => m.medium === "movie")!;
    expect(movie.users).toBe(2);
    expect(movie.rated).toBe(30);
    expect(movie.bins[6]).toBe(25);
    expect(movie.bins[5]).toBe(3);
    expect(movie.labels["sure-thing"]).toEqual({ rated: 14, eightPlus: 12 });
    expect(s.media.find((m) => m.medium === "game")).toBeUndefined();
    expect(s.all.rated).toBe(30);
    expect(s.all.bins[6]).toBe(25);
    expect(s.binFrom).toBe(-6);
  });
});
