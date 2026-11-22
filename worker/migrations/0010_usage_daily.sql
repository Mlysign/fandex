-- Usage counters (src/usage.ts): "key K happened N times on day D".
--
-- No user_id, on purpose, like the pageview tables in 0001: a row is a total
-- for everybody, so erasure and export have nothing to find here and the
-- table must never gain a column that names an account or a device.
--
-- The natural key is the primary key of a WITHOUT ROWID table, so a count is
-- one row write and there is no second index to pay for.
CREATE TABLE usage_daily (
  day TEXT NOT NULL,
  key TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, key)
) WITHOUT ROWID;
