/**
 * The Scoring admin's writes: the engine's knobs and the tag categories. Ports
 * of the site's src/lib/scoringConfig.ts writers and the zod schemas in front
 * of them (src/lib/schemas.ts), hand-checked because zod is not in this bundle.
 *
 * Every device reads these tables through /v1/taxonomy and applies them when
 * it scores, so an edit here is a few row writes and reaches a device the next
 * time it asks. Nothing stored per item has to be rewritten.
 */

import { ipKey } from "@/lib/facets";
import { BadRequest } from "./me";
import { first, run } from "./d1";

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown, name: string): number => {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new BadRequest(`${name} must be a number`);
  return v;
};
const positive = (v: unknown, name: string): number => {
  const n = num(v, name);
  if (n <= 0) throw new BadRequest(`${name} must be above zero`);
  return n;
};
const count = (v: unknown, name: string): number => {
  const n = num(v, name);
  if (!Number.isInteger(n) || n < 0 || n > 1000) throw new BadRequest(`${name} must be a whole number`);
  return n;
};

export interface ScoringConfig {
  roleWeights: Record<string, number>;
  priorStrength: number;
  mappingConstantUp: number;
  mappingConstantDown: number;
  topTagsPositive: number;
  topTagsNegative: number;
  topPeople: number;
  topCompanies: number;
  topIps: number;
}

/** The whole config or a refusal: a save replaces the stored object, so a half one must not get through. */
export function parseScoringConfig(body: unknown): ScoringConfig {
  if (!isObj(body)) throw new BadRequest("Expected the scoring config");
  if (!isObj(body.roleWeights)) throw new BadRequest("roleWeights must be an object");
  const roleWeights: Record<string, number> = {};
  const roles = Object.entries(body.roleWeights);
  if (roles.length > 40) throw new BadRequest("Too many roles");
  for (const [role, weight] of roles) {
    if (!/^[a-z_]{1,32}$/.test(role)) throw new BadRequest("Unknown role");
    roleWeights[role] = num(weight, `roleWeights.${role}`);
  }
  return {
    roleWeights,
    priorStrength: positive(body.priorStrength, "priorStrength"),
    mappingConstantUp: positive(body.mappingConstantUp, "mappingConstantUp"),
    mappingConstantDown: positive(body.mappingConstantDown, "mappingConstantDown"),
    topTagsPositive: count(body.topTagsPositive, "topTagsPositive"),
    topTagsNegative: count(body.topTagsNegative, "topTagsNegative"),
    topPeople: count(body.topPeople, "topPeople"),
    topCompanies: count(body.topCompanies, "topCompanies"),
    topIps: count(body.topIps, "topIps"),
  };
}

export async function saveScoringConfig(db: D1Database, config: ScoringConfig): Promise<void> {
  // An upsert, so a database that never had the row gets one. The version is
  // what a device could key a cache on; it only ever goes up.
  await run(
    db,
    `INSERT INTO scoring_config (id, config, version, updated_at) VALUES (1, ?1, 1, unixepoch())
     ON CONFLICT(id) DO UPDATE SET config = ?1, version = version + 1, updated_at = unixepoch()`,
    [JSON.stringify(config)],
  );
}

export interface CategoryWeight { id: string; weight: number; ignored: boolean }

const categoryId = (v: unknown): string => {
  if (typeof v !== "string" || !/^[a-z0-9-]{1,64}$/.test(v)) throw new BadRequest("id must be lowercase-kebab");
  return v;
};

export function parseCategoryWeights(body: unknown): CategoryWeight[] {
  if (!isObj(body) || !Array.isArray(body.updates) || body.updates.length > 200) throw new BadRequest("Expected {updates: [...]}");
  return body.updates.map((u) => {
    if (!isObj(u)) throw new BadRequest("Each update must be an object");
    const weight = num(u.weight, "weight");
    if (weight < 0) throw new BadRequest("weight must not be negative");
    if (typeof u.ignored !== "boolean") throw new BadRequest("ignored must be true or false");
    return { id: categoryId(u.id), weight, ignored: u.ignored };
  });
}

/** Weight and ignored only. A category's name, colour and place are the Taxonomy tab's. */
export async function saveCategoryWeights(db: D1Database, updates: CategoryWeight[]): Promise<void> {
  if (!updates.length) return;
  await db.batch(updates.map((u) =>
    db.prepare("UPDATE tag_category SET weight = ?, ignored = ?, updated_at = unixepoch() WHERE id = ?").bind(u.weight, u.ignored ? 1 : 0, u.id)));
}

export interface CategoryEdit { id: string; label: string; color: string; weight: number; ignored: boolean; sortOrder?: number }

export function parseCategory(body: unknown): CategoryEdit {
  if (!isObj(body)) throw new BadRequest("Expected a category");
  if (typeof body.label !== "string" || !body.label.trim() || body.label.length > 64) throw new BadRequest("label is required");
  if (typeof body.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(body.color)) throw new BadRequest("color must be a #rrggbb hex value");
  const weight = num(body.weight, "weight");
  if (weight < 0) throw new BadRequest("weight must not be negative");
  if (typeof body.ignored !== "boolean") throw new BadRequest("ignored must be true or false");
  return {
    id: categoryId(body.id), label: body.label.trim(), color: body.color, weight, ignored: body.ignored,
    sortOrder: body.sortOrder === undefined ? undefined : count(body.sortOrder, "sortOrder"),
  };
}

/** Create a category or edit one. A new one goes to the end of the list. */
export async function saveCategory(db: D1Database, c: CategoryEdit): Promise<void> {
  await run(
    db,
    `INSERT INTO tag_category (id, label, color, weight, ignored, sort_order, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, COALESCE(?6, (SELECT COUNT(*) FROM tag_category)), unixepoch())
     ON CONFLICT(id) DO UPDATE SET label = excluded.label, color = excluded.color, weight = excluded.weight,
       ignored = excluded.ignored, sort_order = COALESCE(?6, tag_category.sort_order), updated_at = excluded.updated_at`,
    [c.id, c.label, c.color, c.weight, c.ignored ? 1 : 0, c.sortOrder ?? null],
  );
}

/**
 * Delete a category. Every tag moved into it by hand goes back to where the
 * code would have put it: the override rows go with it (ON DELETE CASCADE).
 */
export async function deleteCategory(db: D1Database, id: string): Promise<void> {
  await run(db, "DELETE FROM tag_category WHERE id = ?", [categoryId(id)]);
}

// ── Tags: which category, which spelling, which tags are one tag ─────────────

const key = (v: unknown, name: string): string => {
  if (typeof v !== "string" || !v || v.length > 200) throw new BadRequest(`${name} is required`);
  return v;
};

export function parseTagOverrides(body: unknown): { tagKeys: string[]; categoryId: string } {
  if (!isObj(body)) throw new BadRequest("Expected {tagKeys, categoryId}");
  const many = body.tagKeys === undefined ? [] : body.tagKeys;
  if (!Array.isArray(many) || many.length > 2000) throw new BadRequest("tagKeys must be a list of at most 2,000");
  const tagKeys = [...new Set([...many.map((k) => key(k, "tagKey")), ...(body.tagKey === undefined ? [] : [key(body.tagKey, "tagKey")])])];
  if (!tagKeys.length) throw new BadRequest("tagKey or tagKeys required");
  return { tagKeys, categoryId: categoryId(body.categoryId) };
}

/** Move tags into a category by hand. Answers how many were moved. */
export async function setTagOverrides(db: D1Database, tagKeys: string[], category: string): Promise<number> {
  // The foreign key would refuse an unknown category with a constraint error;
  // this says it in words instead.
  if (!(await first<{ id: string }>(db, "SELECT id FROM tag_category WHERE id = ?", [category]))) throw new BadRequest("No such category");
  const put = db.prepare(
    `INSERT INTO tag_category_override (tag_key, category_id, updated_at) VALUES (?, ?, unixepoch())
     ON CONFLICT(tag_key) DO UPDATE SET category_id = excluded.category_id, updated_at = excluded.updated_at`,
  );
  // D1 takes at most a hundred statements in a batch.
  for (let i = 0; i < tagKeys.length; i += 100) await db.batch(tagKeys.slice(i, i + 100).map((k) => put.bind(k, category)));
  return tagKeys.length;
}

/** Back to wherever the code puts the tag. */
export async function clearTagOverride(db: D1Database, tagKey: string): Promise<void> {
  await run(db, "DELETE FROM tag_category_override WHERE tag_key = ?", [key(tagKey, "tagKey")]);
}

/** `tag_alias` folds tags into one tag; `ip_alias` folds franchises into one franchise. Same shape, same rules. */
export type AliasTable = "tag_alias" | "ip_alias";

export function parseAliases(body: unknown): { canonical: string; members: string[]; displayLabel?: string } {
  if (!isObj(body) || !Array.isArray(body.members) || !body.members.length || body.members.length > 500) throw new BadRequest("Expected {canonical, members}");
  let displayLabel: string | undefined;
  if (body.displayLabel !== undefined) {
    if (typeof body.displayLabel !== "string" || !body.displayLabel.trim() || body.displayLabel.length > 200) throw new BadRequest("displayLabel must be a short name");
    displayLabel = body.displayLabel.trim();
  }
  return { canonical: key(body.canonical, "canonical"), members: body.members.map((m) => key(m, "member")), displayLabel };
}

/**
 * Make `alias` another name for `canonical`. Flat by construction, as on the
 * site: the target is resolved to its own canonical first, and anything that
 * pointed at `alias` is re-pointed, so no chain is ever stored.
 */
export async function setAlias(db: D1Database, table: AliasTable, alias: string, canonical: string): Promise<void> {
  const target = (await first<{ c: string }>(db, `SELECT canonical_key c FROM ${table} WHERE alias_key = ?`, [canonical]))?.c ?? canonical;
  if (alias === target) throw new BadRequest("A tag cannot be an alias of itself.");
  await db.batch([
    db.prepare(`UPDATE ${table} SET canonical_key = ?, updated_at = unixepoch() WHERE canonical_key = ?`).bind(target, alias),
    db.prepare(
      `INSERT INTO ${table} (alias_key, canonical_key, updated_at) VALUES (?, ?, unixepoch())
       ON CONFLICT(alias_key) DO UPDATE SET canonical_key = excluded.canonical_key, updated_at = excluded.updated_at`,
    ).bind(alias, target),
  ]);
}

export async function deleteAlias(db: D1Database, table: AliasTable, alias: string): Promise<void> {
  await run(db, `DELETE FROM ${table} WHERE alias_key = ?`, [key(alias, "alias")]);
}

/** Take a whole bundle apart: every name that pointed at `canonical` stands alone again. */
export async function deleteBundle(db: D1Database, table: AliasTable, canonical: string): Promise<void> {
  await run(db, `DELETE FROM ${table} WHERE canonical_key = ?`, [key(canonical, "canonical")]);
}

export function parseLabel(body: unknown): { kind: "tag" | "ip"; key: string; label: string } {
  if (!isObj(body) || (body.kind !== "tag" && body.kind !== "ip")) throw new BadRequest("kind must be tag or ip");
  if (typeof body.label !== "string" || !body.label.trim() || body.label.length > 200) throw new BadRequest("A display name cannot be blank.");
  return { kind: body.kind, key: key(body.key, "key"), label: body.label.trim() };
}

/** The spelling people see for a tag or a franchise, whatever the providers call it. */
export async function setLabel(db: D1Database, kind: "tag" | "ip", k: string, label: string): Promise<void> {
  await run(
    db,
    `INSERT INTO facet_label_override (kind, key, label, updated_at) VALUES (?, ?, ?, unixepoch())
     ON CONFLICT(kind, key) DO UPDATE SET label = excluded.label, updated_at = excluded.updated_at`,
    [kind, k, label],
  );
}

export async function clearLabel(db: D1Database, kind: string | null, k: string | null): Promise<void> {
  if (kind !== "tag" && kind !== "ip") throw new BadRequest("kind must be tag or ip");
  await run(db, "DELETE FROM facet_label_override WHERE kind = ? AND key = ?", [kind, key(k, "key")]);
}

// ── Franchises: which titles belong to one, by hand ──────────────────────────

export interface IpOverride { mediaItemId: string; raw: string; mode: "add" | "remove"; label: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Attach a title to a franchise, or detach it from one a provider put it in.
 * `raw` is a franchise key or a name; either way it goes through `ipKey`, so an
 * attach by name and the provider's own spelling land on the same franchise.
 */
export function parseIpOverride(body: unknown): IpOverride {
  if (!isObj(body)) throw new BadRequest("Expected {mediaItemId, mode, label}");
  if (typeof body.mediaItemId !== "string" || !UUID.test(body.mediaItemId)) throw new BadRequest("mediaItemId must be an item id");
  if (body.mode !== "add" && body.mode !== "remove") throw new BadRequest("mode must be add or remove");
  const raw = key(body.ipKey ?? body.label, "label");
  const label = body.label === undefined || body.label === "" ? raw : key(body.label, "label");
  return { mediaItemId: body.mediaItemId.toLowerCase(), raw, mode: body.mode, label: label.trim() };
}

/** The franchise a key or a name belongs to after bundling. */
async function canonicalIp(db: D1Database, raw: string): Promise<string> {
  const k = ipKey(raw);
  if (!k) throw new BadRequest("Empty franchise key.");
  return (await first<{ c: string }>(db, "SELECT canonical_key c FROM ip_alias WHERE alias_key = ?", [k]))?.c ?? k;
}

export async function setIpOverride(db: D1Database, o: IpOverride): Promise<{ ipKey: string }> {
  const k = await canonicalIp(db, o.raw);
  // A row somebody made by hand is never overwritten by one a job made.
  await run(
    db,
    `INSERT INTO item_ip_override (media_item_id, ip_key, label, mode, source, updated_at)
     VALUES (?, ?, ?, ?, 'manual', unixepoch())
     ON CONFLICT(media_item_id, ip_key) DO UPDATE SET
       label = excluded.label, mode = excluded.mode, source = excluded.source, updated_at = excluded.updated_at`,
    [o.mediaItemId, k, o.label, o.mode],
  );
  return { ipKey: k };
}

/** Forget a hand-made attach or detach: the title goes back to what the providers say. */
export async function clearIpOverride(db: D1Database, mediaItemId: string | null, raw: string | null): Promise<void> {
  if (!mediaItemId || !UUID.test(mediaItemId)) throw new BadRequest("mediaItemId must be an item id");
  await run(db, "DELETE FROM item_ip_override WHERE media_item_id = ? AND ip_key = ?", [mediaItemId.toLowerCase(), await canonicalIp(db, key(raw, "ipKey"))]);
}
