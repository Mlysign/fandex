// The app in a browser, talking to a Worker on this machine instead of the live
// one. With that Worker's test accounts switched on (worker/scripts/dev-stack.mjs)
// this is where a rating, a hide or a deleted account can be tried for real.
//
// A script and not a line in package.json: setting an environment variable for
// one command is written differently in every shell.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mobile = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const api = process.env.FANDEX_LOCAL_API ?? 'http://localhost:8787';

const child = spawn(
  process.execPath,
  [path.join(mobile, 'node_modules', 'expo', 'bin', 'cli'), 'start', '--web', '--port', '8081', ...process.argv.slice(2)],
  { cwd: mobile, stdio: 'inherit', env: { ...process.env, EXPO_PUBLIC_API_URL: api } },
);
child.on('exit', (code) => process.exit(code ?? 0));
