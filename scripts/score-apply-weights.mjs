// Apply a weight change the search proposed, with an undo, on live D1.
//
//   node scripts/score-apply-weights.mjs --taxonomy taxonomy.json [--proposal proposal.json] [--gains 1.3,5.3] [--apply]
//
// `proposal.json` is what `scripts/score-tune.mjs --out` writes; only a proposal
// whose verdict was `ship` is applied (the search proved it on titles it never
// saw). `--gains up,down` sets the two gains as well (refit them with
// `score-backtest.mjs --fit-gains` after the weights change, and set them only
// when the backtest at the new gains is better). `taxonomy.json` is the live
// /v1/taxonomy the proposal was measured on: the undo restores its values.
//
// Writes docs/archive/score-weights/<stamp>.sql and -undo.sql, then (with --apply)
// runs the first. Category weights are `tag_category.weight`; role and tier weights
// and the gains are keys inside `scoring_config.config` (json_set, version + 1).
// The taxonomy kept in kv is dropped last, so devices see the change on their next check.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const repo = path.dirname(here);
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : [])).filter((p) => p.length));
if (!args.taxonomy || (!args.proposal && !args.gains)) { console.error('usage: node scripts/score-apply-weights.mjs --taxonomy t.json [--proposal p.json] [--gains up,down] [--apply]'); process.exit(2); }
// Without a proposal only the gains move.
const proposal = args.proposal ? JSON.parse(fs.readFileSync(args.proposal, 'utf8')) : { ship: false, changes: [] };
const tax = JSON.parse(fs.readFileSync(args.taxonomy, 'utf8'));
const cfg = tax.scoring?.config ?? {};

const sql = [];
const undo = [];
const said = [];
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const num = (v) => { const n = Number(v); if (!Number.isFinite(n) || n < 0) throw new Error(`not a weight: ${v}`); return n; };
const setConfig = (jsonPath, to, from) => {
  sql.push(`UPDATE scoring_config SET config = json_set(config, '${jsonPath}', ${num(to)}), version = version + 1, updated_at = unixepoch() WHERE id = 1;`);
  undo.push(`UPDATE scoring_config SET config = json_set(config, '${jsonPath}', ${num(from)}), version = version + 1, updated_at = unixepoch() WHERE id = 1;`);
};

if (proposal.changes?.length && !proposal.ship) { console.error('the proposal\'s verdict was "keep the weights": nothing of it is applied'); process.exit(1); }
for (const c of proposal.ship ? proposal.changes : []) {
  if (c.group === 'category') {
    const row = tax.tagCategories.find((x) => x.id === c.key);
    if (!row) throw new Error(`no category ${c.key}`);
    sql.push(`UPDATE tag_category SET weight = ${num(c.to)}, updated_at = unixepoch() WHERE id = ${q(c.key)};`);
    undo.push(`UPDATE tag_category SET weight = ${num(row.weight)}, updated_at = unixepoch() WHERE id = ${q(c.key)};`);
  } else if (c.group === 'role') {
    if (!/^[a-z]+$/.test(c.key)) throw new Error(`odd role ${c.key}`);
    setConfig(`$.roleWeights.${c.key}`, c.to, cfg.roleWeights?.[c.key] ?? c.from);
  } else if (c.group === 'tier') {
    if (!/^[a-z]+$/.test(c.key)) throw new Error(`odd tier ${c.key}`);
    setConfig(`$.tagTierWeights.${c.key}`, c.to, cfg.tagTierWeights?.[c.key] ?? c.from);
  } else throw new Error(`unknown group ${c.group}`);
  said.push(`${c.group} ${c.key} ${c.from} → ${c.to}`);
}
if (args.gains && args.gains !== true) {
  const [up, down] = String(args.gains).split(',').map(num);
  if (up !== cfg.mappingConstantUp) { setConfig('$.mappingConstantUp', up, cfg.mappingConstantUp); said.push(`gain up ${cfg.mappingConstantUp} → ${up}`); }
  if (down !== cfg.mappingConstantDown) { setConfig('$.mappingConstantDown', down, cfg.mappingConstantDown); said.push(`gain down ${cfg.mappingConstantDown} → ${down}`); }
}
if (!sql.length) { console.log('nothing to change'); process.exit(0); }

const DROP = "DELETE FROM kv WHERE key IN ('taxonomy', 'taxonomy_etag');";
const now = new Date();
const stamp = `${now.toISOString().slice(0, 10)}-${now.toISOString().slice(11, 16).replace(':', '')}`;
const dir = path.join(repo, 'docs', 'archive', 'score-weights');
fs.mkdirSync(dir, { recursive: true });
const head = `-- Score weights, ${stamp}: ${said.join('; ')}.\n-- Checking half ${proposal.start?.check?.toFixed?.(3) ?? '?'} → ${proposal.proposed?.check?.toFixed?.(3) ?? '?'} (scripts/score-tune.mjs). Undo: ${stamp}-undo.sql.`;
fs.writeFileSync(path.join(dir, `${stamp}.sql`), `${head}\n${[...sql, DROP].join('\n')}\n`);
fs.writeFileSync(path.join(dir, `${stamp}-undo.sql`), `-- Undo for ${stamp}.sql\n${[...undo, DROP].join('\n')}\n`);
console.log(`${said.join('; ')}\nwritten: docs/archive/score-weights/${stamp}.sql and -undo.sql`);
if (!args.apply) { console.log('dry run: add --apply to run it on live D1'); process.exit(0); }
const wrangler = path.join(repo, 'worker', 'node_modules', 'wrangler', 'bin', 'wrangler.js');
execFileSync(process.execPath, [wrangler, 'd1', 'execute', 'fandex', '--remote', '--file', path.join(dir, `${stamp}.sql`), '--yes'], { cwd: path.join(repo, 'worker'), stdio: 'inherit' });
console.log('applied');
