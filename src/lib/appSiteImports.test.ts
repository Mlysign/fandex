import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The app (mobile/) imports modules from this site (`@/lib/...`). None of them
// may reach the database module, by any chain of imports, not even for a type.
//
// Why a test and not the app's typecheck: on a developer's machine this
// package's node_modules sit one folder above mobile/, so `better-sqlite3` and
// Node's types resolve and the app's `tsc` passes. CI installs the app's own
// packages only, and the same check fails there. On 2026-10-11 a type imported
// from discovery.ts, through two modules that only wanted the shape of a title,
// did exactly that: green locally, red in CI, on three pushes.
//
// It lives in the site's suite because it reads files, and only this package
// has Node's types. The app's suite has none.

const SITE_SRC = path.resolve(__dirname, '..');
const APP_SRC = path.resolve(__dirname, '../../mobile/src');
// The website's build (render.tsx) is typechecked with the app and imports site
// modules of its own; on 2026-10-17 its `jsonLd` import reached db.ts through a
// type, and this test, walking mobile/src alone, said nothing while CI was red.
const APP_WEB = path.resolve(__dirname, '../../mobile/web');
const APP_ROOTS = [APP_SRC, APP_WEB];
/** Build output and installed packages under those roots: never the app's own code. */
const SKIP_DIRS = new Set(['dist', 'node_modules', 'www']);

/** What the app's build has no business near. Everything else that is server-only imports one of these. */
const FORBIDDEN_FILES = new Set(['lib/db.ts']);
const FORBIDDEN_PACKAGES = /^(better-sqlite3|fs|path|node:.+)$/;

const IMPORT = /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

function specifiers(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const out: string[] = [];
  for (const m of source.matchAll(IMPORT)) out.push(m[1] ?? m[2]);
  return out;
}

function walk(dir: string, into: string[] = []): string[] {
  if (!existsSync(dir)) return into;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) { if (!SKIP_DIRS.has(name)) walk(full, into); }
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) into.push(full);
  }
  return into;
}

function resolveSite(spec: string, from: string): string | null {
  const base = spec.startsWith('@/') ? path.join(SITE_SRC, spec.slice(2)) : spec.startsWith('.') ? path.resolve(path.dirname(from), spec) : null;
  if (!base) return null;
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), base]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const rel = (file: string) => path.relative(SITE_SRC, file).replace(/\\/g, '/');

describe("the app's imports from the old site", () => {
  // Every site module the app reaches, with the chain that led there.
  const reached = new Map<string, string[]>();
  const queue: string[] = [];
  for (const root of APP_ROOTS) {
    for (const file of walk(root)) {
      for (const spec of specifiers(file)) {
        if (!spec.startsWith('@/')) continue;
        const target = resolveSite(spec, file);
        if (target && !reached.has(target)) {
          reached.set(target, [path.relative(path.dirname(root), file).replace(/\\/g, '/'), rel(target)]);
          queue.push(target);
        }
      }
    }
  }
  const packages: { pkg: string; chain: string[] }[] = [];
  while (queue.length) {
    const file = queue.shift()!;
    const chain = reached.get(file)!;
    for (const spec of specifiers(file)) {
      if (FORBIDDEN_PACKAGES.test(spec)) packages.push({ pkg: spec, chain });
      const target = resolveSite(spec, file);
      if (target && target.startsWith(SITE_SRC) && !reached.has(target)) {
        reached.set(target, [...chain, rel(target)]);
        queue.push(target);
      }
    }
  }

  it('finds the modules it is meant to be checking', () => {
    // A resolver that silently finds nothing would pass every check below.
    expect(reached.size).toBeGreaterThan(8);
    expect([...reached.keys()].map(rel)).toContain('lib/facets.ts');
  });

  it('never reaches the database module, not even for a type', () => {
    const hits = [...reached].filter(([file]) => FORBIDDEN_FILES.has(rel(file))).map(([, chain]) => chain.join(' → '));
    expect(hits).toEqual([]);
  });

  it('never reaches a package only a server has', () => {
    expect(packages.map((p) => `${p.pkg} via ${p.chain.join(' → ')}`)).toEqual([]);
  });
});
