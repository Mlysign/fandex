// Module resolve hook: teaches plain `node` the two things a bundler does for
// free, so scripts/migrate.mjs can import the app's real TypeScript modules.
//
// Node resolves neither of these on its own:
//   1. the `@/*` -> `src/*` alias (a tsconfig/vitest/Next path mapping)
//   2. extensionless specifiers ("./sources/project" -> "./sources/project.ts")
//
// Node >= 22.18 strips types from .ts natively, so once a specifier resolves to a
// real file it loads with no transpiler involved. This hook only does resolution.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

// scripts/ -> repo root -> src/
const SRC = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "src");

// Mirrors the resolution order a bundler uses for an extensionless specifier.
// No bare "" entry: a directory would "exist" and resolve to a non-module.
const CANDIDATES = [".ts", ".tsx", ".mts", ".js", "/index.ts", "/index.tsx", "/index.js"];

function firstExisting(basePath) {
  if (path.extname(basePath) && existsSync(basePath)) return basePath;
  return CANDIDATES.map((ext) => basePath + ext).find((c) => existsSync(c)) ?? null;
}

export function resolve(specifier, context, nextResolve) {
  let basePath = null;

  if (specifier.startsWith("@/")) {
    basePath = path.join(SRC, specifier.slice(2));
  } else if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    // Only rewrite relative specifiers that lack an extension; anything already
    // resolvable is left for Node's own resolver.
    if (!path.extname(specifier)) {
      basePath = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
    }
  }

  if (basePath) {
    const hit = firstExisting(basePath);
    if (hit) return nextResolve(pathToFileURL(hit).href, context);
  }

  return nextResolve(specifier, context);
}
