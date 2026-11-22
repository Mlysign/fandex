import { beforeEach, describe, expect, it } from "vitest";
import { forgetExhausted, spendSoft } from "../src/budget";
import { count, db, wipe } from "./helpers";

// A cap on READS is counted in the isolate and written now and then, so a
// catalog page or a lookup no longer costs a row write of its own.

/** Collects what a request would hand to ctx.waitUntil, to be awaited by the test. */
function deferred() {
  const waiting: Promise<unknown>[] = [];
  return { defer: (p: Promise<unknown>) => { waiting.push(p); }, settle: () => Promise.all(waiting.splice(0)) };
}
const total = async (kind: string) =>
  (await db.prepare("SELECT n FROM daily_budget WHERE kind = ?").bind(kind).first<{ n: number }>())?.n ?? 0;

beforeEach(async () => {
  await wipe();
  forgetExhausted();
});

describe("a read cap counted in the isolate", () => {
  it("writes one row for many calls, and the row holds all of them", async () => {
    const d = deferred();
    for (let i = 0; i < 50; i++) expect(spendSoft(db, "delta_pages", 1000, 1, d.defer)).toBe(true);
    await d.settle();
    // The first call wrote at once (a new isolate knows nothing yet); the other 49 wait for the next write.
    expect(await count("daily_budget", "kind = 'delta_pages'")).toBe(1);
    expect(await total("delta_pages")).toBe(1);
    // Refusing writes what was waiting, so nothing counted is lost at the cap.
    expect(spendSoft(db, "delta_pages", 50, 1, d.defer)).toBe(false);
    await d.settle();
    expect(await total("delta_pages")).toBe(51);
  });

  it("refuses past the cap, and keeps refusing without another write", async () => {
    const d = deferred();
    expect(spendSoft(db, "lookup_refs", 40, 20, d.defer)).toBe(true);
    expect(spendSoft(db, "lookup_refs", 40, 20, d.defer)).toBe(true);
    expect(spendSoft(db, "lookup_refs", 40, 20, d.defer)).toBe(false);
    await d.settle();
    const after = await total("lookup_refs");
    expect(spendSoft(db, "lookup_refs", 40, 20, d.defer)).toBe(false);
    await d.settle();
    expect(await total("lookup_refs")).toBe(after);
  });

  it("learns what other isolates spent from its own write", async () => {
    const day = new Date().toISOString().slice(0, 10);
    // Another isolate has spent 95 of 100 today.
    await db.prepare("INSERT INTO daily_budget (day, kind, n) VALUES (?, 'date_films', 95)").bind(day).run();
    const d = deferred();
    // This one knows nothing yet, so its first call goes through, and its write tells it the total.
    expect(spendSoft(db, "date_films", 100, 20, d.defer)).toBe(true);
    await d.settle();
    expect(await total("date_films")).toBe(115);
    expect(spendSoft(db, "date_films", 100, 20, d.defer)).toBe(false);
  });
});
