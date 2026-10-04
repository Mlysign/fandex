// Metro for the Fandex app.
//
// Two things beyond Expo's default:
//
// 1. THE SITE'S MODULES ARE IMPORTABLE. The app reuses pure TypeScript from the
//    Next.js site one directory up (docs/app-plan.md: a third of that code is
//    meant to carry over). Those files import each other as "@/lib/…", which in
//    the site means <repo>/src. So here:
//        "@/…"  ->  <repo>/src/…      the site's modules, unchanged
//        "~/…"  ->  mobile/src/…      this app's own modules
//    Two prefixes rather than one, because a single "@/" cannot mean both and
//    the site's files cannot be edited to say something else.
//
// 2. expo-sqlite ON THE WEB needs its .wasm served as an asset, and the page
//    cross-origin isolated (SharedArrayBuffer), hence the two headers.
//
// ⚠️ A site module imported here must not reach "@/lib/db" (better-sqlite3) or
// anything Node-only, the same rule the Cloudflare Worker lives by.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

const siteSrc = path.resolve(__dirname, '..', 'src');
const appSrc = path.resolve(__dirname, 'src');

config.watchFolders = [...(config.watchFolders ?? []), siteSrc];
// A site file has no node_modules of its own to find react or expo in.
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')];
config.resolver.assetExts = [...config.resolver.assetExts, 'wasm'];

const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstream ?? context.resolveRequest;
  if (moduleName.startsWith('@/')) return resolve(context, path.join(siteSrc, moduleName.slice(2)), platform);
  if (moduleName.startsWith('~/')) return resolve(context, path.join(appSrc, moduleName.slice(2)), platform);
  return resolve(context, moduleName, platform);
};

config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => (req, res, next) => {
    // "credentialless" rather than "require-corp": posters come from TMDB's and
    // IGDB's CDNs, which send no CORP header and would all be blocked.
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    return middleware(req, res, next);
  },
};

module.exports = config;
