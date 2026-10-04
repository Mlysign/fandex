// Thin helpers over the D1 binding, named after the ones in src/lib/db.ts so the
// ported code reads the same. Every one of these is a round trip, and a Worker
// on the free plan gets 50 of them per invocation, so callers batch.

export async function all<T>(db: D1Database, sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await db.prepare(sql).bind(...params).all<T>();
  return res.results ?? [];
}

export async function first<T>(db: D1Database, sql: string, params: unknown[] = []): Promise<T | null> {
  return (await db.prepare(sql).bind(...params).first<T>()) ?? null;
}

export async function run(db: D1Database, sql: string, params: unknown[] = []): Promise<D1Meta> {
  const res = await db.prepare(sql).bind(...params).run();
  return res.meta;
}

export function stmt(db: D1Database, sql: string, params: unknown[] = []): D1PreparedStatement {
  return db.prepare(sql).bind(...params);
}

/** D1 runs a batch as one transaction: every statement applies or none do. */
export async function batch(db: D1Database, statements: D1PreparedStatement[]): Promise<D1Result[]> {
  if (!statements.length) return [];
  return db.batch(statements);
}

/** True for a UNIQUE / PRIMARY KEY violation, however D1 words it this month. */
export function isConstraintError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT|constraint failed/i.test(msg);
}

export function utcDay(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
