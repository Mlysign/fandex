import { describe, expect, it } from 'vitest';
import type { SQLiteDatabase } from 'expo-sqlite';
import { inTransaction } from '~/lib/db';

/** A connection that fails the way SQLite does when a second BEGIN arrives. */
function connection() {
  let open = false;
  const log: string[] = [];
  const db = {
    async withTransactionAsync(task: () => Promise<void>) {
      if (open) throw new Error('cannot start a transaction within a transaction');
      open = true;
      try { await task(); } finally { open = false; }
    },
  } as unknown as SQLiteDatabase;
  return { db, log };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 5));

describe('inTransaction', () => {
  it('queues overlapping transactions instead of nesting them', async () => {
    const { db, log } = connection();
    await Promise.all([
      inTransaction(db, async () => { log.push('a start'); await tick(); log.push('a end'); }),
      inTransaction(db, async () => { log.push('b start'); await tick(); log.push('b end'); }),
    ]);
    expect(log).toEqual(['a start', 'a end', 'b start', 'b end']);
  });

  it('gives a failure to its own caller and still runs the next one', async () => {
    const { db, log } = connection();
    const failed = inTransaction(db, async () => { throw new Error('first'); });
    const next = inTransaction(db, async () => { log.push('second ran'); });
    await expect(failed).rejects.toThrow('first');
    await next;
    expect(log).toEqual(['second ran']);
  });
});
