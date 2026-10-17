// For tests only: expo-sqlite's async surface over Node's own SQLite, so a test
// runs the app's real SQL and real migrations. Nothing in the app imports this.
//
// The app has no Node types (it runs on a phone), so the module is named
// through a variable and typed by hand, as much as is used here.

import type { SQLiteDatabase } from 'expo-sqlite';

export interface RawStatement { run(...p: unknown[]): unknown; all(...p: unknown[]): unknown[]; get(...p: unknown[]): unknown }
export interface RawDatabase { exec(sql: string): void; prepare(sql: string): RawStatement }

const NODE_SQLITE = 'node:sqlite';

export async function openTestDb(): Promise<{ db: SQLiteDatabase; raw: RawDatabase }> {
  const { DatabaseSync } = (await import(/* @vite-ignore */ NODE_SQLITE)) as { DatabaseSync: new (path: string) => RawDatabase };
  const raw = new DatabaseSync(':memory:');
  const db = {
    async execAsync(sql: string) { raw.exec(sql); },
    async runAsync(sql: string, params: unknown[] = []) { raw.prepare(sql).run(...params); },
    async getAllAsync(sql: string, params: unknown[] = []) { return raw.prepare(sql).all(...params); },
    async getFirstAsync(sql: string, params: unknown[] = []) { return raw.prepare(sql).get(...params) ?? null; },
    async prepareAsync(sql: string) {
      const st = raw.prepare(sql);
      return { async executeAsync(params: unknown[] = []) { st.run(...params); }, async finalizeAsync() {} };
    },
    async withTransactionAsync(task: () => Promise<void>) {
      raw.exec('BEGIN');
      try { await task(); raw.exec('COMMIT'); } catch (e) { raw.exec('ROLLBACK'); throw e; }
    },
  } as unknown as SQLiteDatabase;
  return { db, raw };
}
