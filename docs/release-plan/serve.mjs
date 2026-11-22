// The release plan's local server: serves index.html and saves comments and
// statuses to comments.json and status.json beside it, so a session can read them.
// Zero dependencies. Listens on 127.0.0.1 only.
//
//   node docs/release-plan/serve.mjs        then open http://127.0.0.1:4777/
//
// Every write re-reads the file first, so an edit made by hand (or by a session)
// between two clicks in the browser is never overwritten by a stale copy.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, renameSync, existsSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const REPO = join(ROOT, '..', '..');
const PORT = Number(process.env.RELEASE_PLAN_PORT || 4777);
const COMMENTS = join(ROOT, 'comments.json');
const STATUS = join(ROOT, 'status.json');
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const ORIGINS = new Set([...HOSTS].map((h) => `http://${h}`));
const STATUSES = new Set(['todo', 'doing', 'done', 'blocked', 'waiting', 'skip']);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.ttf': 'font/ttf', '.ico': 'image/x-icon',
};

// The app's own fonts, straight out of mobile/node_modules when it is installed.
const F = join(REPO, 'mobile', 'node_modules', '@expo-google-fonts');
const FONTS = {
  'serif.ttf': join(F, 'dm-serif-display', '400Regular', 'DMSerifDisplay_400Regular.ttf'),
  'sans.ttf': join(F, 'space-grotesk', '400Regular', 'SpaceGrotesk_400Regular.ttf'),
  'sans-600.ttf': join(F, 'space-grotesk', '600SemiBold', 'SpaceGrotesk_600SemiBold.ttf'),
  'mono.ttf': join(F, 'space-mono', '400Regular', 'SpaceMono_400Regular.ttf'),
};

function readJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}
function writeJson(file, value) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, file);
}
const loadComments = () => readJson(COMMENTS, { comments: [] });
const loadStatus = () => readJson(STATUS, {});
const now = () => new Date().toISOString();
const newId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const text = (v, max = 5000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 100_000) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
}

async function api(req, res, path) {
  if (path === '/api/ping') return send(res, 200, { ok: true });
  if (path === '/api/state' && req.method === 'GET') {
    const comments = loadComments();
    const status = loadStatus();
    if (!comments || !status) return send(res, 500, { error: 'comments.json or status.json is not valid JSON' });
    return send(res, 200, { comments: comments.comments, status });
  }
  // Everything below writes. A page on another site must not be able to.
  const origin = req.headers.origin;
  if (origin && !ORIGINS.has(origin)) return send(res, 403, { error: 'origin' });
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, { error: 'json only' });
  const body = await readBody(req);

  const st = path.match(/^\/api\/status\/([\w.-]{1,80})$/);
  if (st && req.method === 'PUT') {
    if (!STATUSES.has(body.status)) return send(res, 400, { error: 'status' });
    const status = loadStatus();
    if (!status) return send(res, 500, { error: 'status.json is not valid JSON' });
    status[st[1]] = body.status;
    writeJson(STATUS, status);
    return send(res, 200, { ok: true });
  }

  const store = loadComments();
  if (!store) return send(res, 500, { error: 'comments.json is not valid JSON' });
  if (path === '/api/comments' && req.method === 'POST') {
    const body_ = text(body.text);
    if (!body_) return send(res, 400, { error: 'empty' });
    const c = {
      id: newId(), status: 'open', author: 'Nils', created: now(),
      where: text(body.where, 200), anchor: text(body.anchor, 80), quote: text(body.quote, 600),
      occ: Number.isInteger(body.occ) ? body.occ : 0, text: body_, replies: [],
    };
    store.comments.push(c);
    writeJson(COMMENTS, store);
    return send(res, 200, c);
  }
  const m = path.match(/^\/api\/comments\/(\w{1,40})(\/replies)?$/);
  if (!m) return send(res, 404, { error: 'not found' });
  const c = store.comments.find((x) => x.id === m[1]);
  if (!c) return send(res, 404, { error: 'no such comment' });
  if (m[2] && req.method === 'POST') {
    const body_ = text(body.text);
    if (!body_) return send(res, 400, { error: 'empty' });
    c.replies.push({ author: 'Nils', created: now(), text: body_ });
    c.status = 'open';
  } else if (!m[2] && req.method === 'PATCH') {
    if (body.status === 'open' || body.status === 'resolved') c.status = body.status;
    if (typeof body.text === 'string' && text(body.text)) c.text = text(body.text);
  } else if (!m[2] && req.method === 'DELETE') {
    store.comments.splice(store.comments.indexOf(c), 1);
  } else return send(res, 405, { error: 'method' });
  writeJson(COMMENTS, store);
  return send(res, 200, { ok: true });
}

function file(res, path) {
  if (path === '/') path = '/index.html';
  let target;
  if (path.startsWith('/fonts/')) target = FONTS[path.slice(7)];
  else {
    target = normalize(join(ROOT, decodeURIComponent(path)));
    if (!target.startsWith(ROOT + sep)) target = null;
  }
  const type = target && TYPES[extname(target).toLowerCase()];
  if (!type || !existsSync(target) || !statSync(target).isFile()) return send(res, 404, 'Not found', 'text/plain');
  send(res, 200, readFileSync(target), type);
}

createServer((req, res) => {
  // A DNS name pointed at 127.0.0.1 must not reach the files either.
  if (!HOSTS.has(req.headers.host)) return send(res, 403, 'Forbidden', 'text/plain');
  const path = new URL(req.url, 'http://x').pathname;
  if (!path.startsWith('/api/')) return file(res, path);
  api(req, res, path).catch((e) => send(res, 400, { error: String(e.message || e) }));
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Release plan: http://127.0.0.1:${PORT}/`);
});
