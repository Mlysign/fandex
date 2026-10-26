import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// migrate() returns early once a device's user_version reaches SCHEMA_VERSION.
// 0.3.18 added step 8 and left the constant at 7, so no device already at 7 ever
// ran step 8, and every pull then failed on the missing table (2026-10-26).
// Read from the source: db.ts imports expo-sqlite, which does not load under Node, and the
// app's typecheck has no Node types, so the guard lives with the root's tests (mobile/src/lib/db.ts).
describe('the device schema', () => {
  const src = readFileSync(path.join(process.cwd(), 'mobile', 'src', 'lib', 'db.ts'), 'utf8');

  it('names its newest step as its version', () => {
    const declared = Number(/export const SCHEMA_VERSION = (\d+);/.exec(src)?.[1]);
    const steps = [...src.matchAll(/if \(version < (\d+)\) \{/g)].map((m) => Number(m[1]));
    expect(steps.length).toBeGreaterThan(0);
    expect(declared).toBe(Math.max(...steps));
  });

  it('stamps every step with its own number', () => {
    const steps = [...src.matchAll(/if \(version < (\d+)\) \{/g)].map((m) => Number(m[1]));
    const stamps = [...src.matchAll(/await stamp\(db, \(version = (\d+)\)\);/g)].map((m) => Number(m[1]));
    expect(stamps).toEqual(steps);
  });
});
