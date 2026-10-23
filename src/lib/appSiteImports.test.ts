import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The app (mobile/) and the Worker (worker/) import modules from this site
// (`@/lib/...`). None of them may reach the database module, by any chain of
// imports, not even for a type.
//
// Why a test and not the app's typecheck: on a developer's machine this
// package's node_modules sit one folder above mobile/, so `better-sqlite3` and
// Node's types resolve and the app's `tsc` passes. CI installs the app's own
// packages only, and the same check fails there. On 2026-10-11 a type imported
// from discovery.ts, through two modules that only wanted the shape of a title,
// did exactly that: green locally, red in CI, on three pushes. The same holds
// for any npm package a site module imports that the consumer does not itself
// depend on, so those are refused too.
//
// It lives in the site's suite because it reads files, and only this package
// has Node's types. The app's suite has none.

const SITE_SRC = path.resolve(__dirname, '..');
const REPO = path.resolve(__dirname, '../..');
/** Build output and installed packages under those roots: never the app's own code. */
const SKIP_DIRS = new Set(['dist', 'node_modules', 'www']);

/** What no consumer's build has any business near. Everything else that is server-only imports one of these. */
const FORBIDDEN_FILES = new Set(['lib/db.ts']);

interface Consumer {
  name: string;
  dir: string;
  roots: string[];
  /** Node builtins and server packages this consumer's runtime does not have. */
  forbidden: RegExp;
  /** Check the consumer's OWN files against `forbidden` too, not just the site modules it reaches. */
  checkOwnFiles: boolean;
  /** A module the walk must find, or the resolver is broken. */
  sentinel: string;
}

const CONSUMERS: Consumer[] = [
  {
    name: 'the app',
    dir: path.join(REPO, 'mobile'),
    roots: [
      path.join(REPO, 'mobile/src'),
      // The website's build (render.tsx) is typechecked with the app and imports
      // site modules of its own; on 2026-10-17 its `jsonLd` import reached db.ts
      // through a type, and this test, walking mobile/src alone, said nothing
      // while CI was red.
      path.join(REPO, 'mobile/web'),
    ],
    forbidden: /^(better-sqlite3|fs|path|node:.+)$/,
    // mobile/web's build scripts run under Node and may use its builtins.
    checkOwnFiles: false,
    sentinel: 'lib/facets.ts',
  },
  {
    name: 'the Worker',
    dir: path.join(REPO, 'worker'),
    roots: [path.join(REPO, 'worker/src')],
    // workerd's nodejs_compat covers much of Node, not these. `wrangler deploy
    // --dry-run` in CI is the full check; this one names the chain.
    forbidden: /^(better-sqlite3|(node:)?(fs|fs\/promises|child_process|cluster|worker_threads|dgram|repl|inspector))$/,
    checkOwnFiles: true,
    sentinel: 'lib/http.ts',
  },
];

const BUILTINS = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));

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

/** The npm package a bare specifier names, or null for a path, an alias, a builtin or a runtime module. */
function packageOf(spec: string): string | null {
  if (spec.startsWith('.') || spec.startsWith('@/') || spec.startsWith('~/') || BUILTINS.has(spec) || /^[a-z]+:/.test(spec)) return null;
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function dependencies(dir: string): Set<string> {
  const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  return new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
}

const rel = (file: string) => path.relative(SITE_SRC, file).replace(/\\/g, '/');

for (const consumer of CONSUMERS) {
  describe(`${consumer.name}'s imports from the old site`, () => {
    const deps = dependencies(consumer.dir);
    // Every site module the consumer reaches, with the chain that led there.
    const reached = new Map<string, string[]>();
    const queue: string[] = [];
    const packages: { pkg: string; chain: string[] }[] = [];
    const undeclared: { pkg: string; chain: string[] }[] = [];
    for (const root of consumer.roots) {
      for (const file of walk(root)) {
        const own = path.relative(path.dirname(root), file).replace(/\\/g, '/');
        for (const spec of specifiers(file)) {
          if (consumer.checkOwnFiles && consumer.forbidden.test(spec)) packages.push({ pkg: spec, chain: [own] });
          if (!spec.startsWith('@/')) continue;
          const target = resolveSite(spec, file);
          if (target && !reached.has(target)) {
            reached.set(target, [own, rel(target)]);
            queue.push(target);
          }
        }
      }
    }
    while (queue.length) {
      const file = queue.shift()!;
      const chain = reached.get(file)!;
      for (const spec of specifiers(file)) {
        if (consumer.forbidden.test(spec)) packages.push({ pkg: spec, chain });
        const pkg = packageOf(spec);
        if (pkg && !deps.has(pkg)) undeclared.push({ pkg, chain });
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
      expect([...reached.keys()].map(rel)).toContain(consumer.sentinel);
    });

    it('never reaches the database module, not even for a type', () => {
      const hits = [...reached].filter(([file]) => FORBIDDEN_FILES.has(rel(file))).map(([, chain]) => chain.join(' → '));
      expect(hits).toEqual([]);
    });

    it('never reaches a package only a server has', () => {
      expect(packages.map((p) => `${p.pkg} via ${p.chain.join(' → ')}`)).toEqual([]);
    });

    it('never reaches an npm package it does not itself depend on', () => {
      expect(undeclared.map((p) => `${p.pkg} via ${p.chain.join(' → ')}`)).toEqual([]);
    });
  });
}
