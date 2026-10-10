/**
 * The Scoring admin's writes: the engine's knobs and the tag categories. Ports
 * of the site's src/lib/scoringConfig.ts writers and the zod schemas in front
 * of them (src/lib/schemas.ts), hand-checked because zod is not in this bundle.
 *
 * Every device reads these tables through /v1/taxonomy and applies them when
 * it scores, so an edit here is a few row writes and reaches a device the next
 * time it asks. Nothing stored per item has to be rewritten.
 */

import { BadRequest } from "./me";
import { run } from "./d1";

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
