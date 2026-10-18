// The resolve hook for the sweep's scripts: `@/` is the site's `src/` and `~/`
// the app's `mobile/src/`, the two prefixes the app's modules import by
// (docs/app.md). Node strips the types itself (scripts/alias-hooks.mjs says
// how); this only turns a specifier into a file.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROOTS = { "@/": path.join(REPO, "src"), "~/": path.join(REPO, "mobile", "src") };
const CANDIDATES = [".ts", ".tsx", ".mts", ".js", "/index.ts", "/index.tsx", "/index.js"];

function firstExisting(basePath) {
  if (path.extname(basePath) && existsSync(basePath)) return basePath;
  return CANDIDATES.map((ext) => basePath + ext).find((c) => existsSync(c)) ?? null;
}

export function resolve(specifier, context, nextResolve) {
  let basePath = null;
  const prefix = Object.keys(ROOTS).find((p) => specifier.startsWith(p));
  if (prefix) basePath = path.join(ROOTS[prefix], specifier.slice(prefix.length));
  else if (specifier.startsWith(".") && context.parentURL?.startsWith("file:") && !path.extname(specifier)) {
    basePath = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
  }
  if (basePath) {
    const hit = firstExisting(basePath);
    if (hit) return nextResolve(pathToFileURL(hit).href, context);
  }
  return nextResolve(specifier, context);
}
