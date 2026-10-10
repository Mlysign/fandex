-- A user's state counts are kept on the user's own row instead of being counted
-- on every request (src/keptCounts.ts).
--
-- Why: D1 Free stops ALL queries for the rest of the UTC day past 5 million
-- rows read, and a COUNT reads every row it counts. On 2026-10-10 the counts a
-- device asks for before each pull read 14,899 rows a call, 1.33 million in the
-- day, nearly always to answer "nothing changed".
--
-- Each column is what the last count of one table found, as count:newest, where
-- newest is MAX(updated_at), or MAX(hidden_at), or 0 for no rows. NULL means a
-- row changed since and the next ask counts again. Every statement that writes
-- one of the three tables sets the column to NULL in the same batch.
--
-- No trigger does that, on purpose. D1 reports a trigger's row changes as the
-- changes of the statement that fired it (measured 2026-10-10: an upsert of two
-- rows reported three), and the state write tells the client how many rows it
-- applied and skipped from that number.
--
-- Adding a column rewrites no row, so this costs no row writes. The columns are
-- derived, and the nightly export leaves them out (EXPORT_SKIP_COLUMNS).
-- Comments are plain prose on purpose: this file is passed to D1 as-is.

ALTER TABLE users ADD COLUMN counted_items TEXT;
ALTER TABLE users ADD COLUMN counted_episodes TEXT;
ALTER TABLE users ADD COLUMN counted_hidden TEXT;
