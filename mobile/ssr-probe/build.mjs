// Bundle the render probe for workerd.
//
//   node mobile/ssr-probe/build.mjs
//
// esbuild comes from worker/node_modules (Wrangler ships it); everything the
// bundle imports resolves from mobile/node_modules. The settings mirror what
// Expo's web build does: react-native is react-native-web, and a `.web.*` file
// wins over its plain sibling.

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mobile = path.join(here, '..');
const esbuild = await import(pathToFileURL(path.join(mobile, '..', 'worker', 'node_modules', 'esbuild', 'lib', 'main.js')).href);

const result = await esbuild.build({
  // Aliases resolve from the working directory, so it has to be the package that holds react-native-web.
  absWorkingDir: mobile,
  entryPoints: [path.join(here, 'worker.tsx')],
  outfile: path.join(here, 'dist', 'worker.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  conditions: ['workerd', 'worker', 'browser'],
  mainFields: ['browser', 'module', 'main'],
  resolveExtensions: ['.web.tsx', '.web.ts', '.web.jsx', '.web.js', '.tsx', '.ts', '.jsx', '.js', '.json'],
  jsx: 'automatic',
  minify: true,
  metafile: true,
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', 'process.env.EXPO_OS': '"web"' },
  alias: { 'react-native': 'react-native-web', 'expo-image': path.join(here, 'expo-image.tsx') },
  plugins: [{
    name: 'app-paths',
    setup(build) {
      // `~/x` is mobile/src/x. Resolved through esbuild so the extension rules above apply.
      build.onResolve({ filter: /^~\// }, (args) => build.resolve(`./${args.path.slice(2)}`, { resolveDir: path.join(mobile, 'src'), kind: args.kind }));
    },
  }],
  logLevel: 'warning',
});

const out = Object.values(result.metafile.outputs)[0];
const byPackage = {};
for (const [file, info] of Object.entries(out.inputs)) {
  const m = file.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
  const key = m ? m[1] : 'app';
  byPackage[key] = (byPackage[key] ?? 0) + info.bytesInOutput;
}
console.log(`bundle ${(out.bytes / 1024).toFixed(0)} KB minified`);
for (const [k, v] of Object.entries(byPackage).sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  ${k.padEnd(34)} ${(v / 1024).toFixed(0)} KB`);
