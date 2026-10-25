-- What a person follows or avoids: a tag, a person, a studio or a franchise,
-- keyed the way the score keys a facet (`kind|role|key`, mobile/src/lib/
-- fandexScore.ts). A follow sets the facet's pull to the most anyone can seek
-- out; an avoid sets it to the least. Neither touches the taste axis, which
-- stays measured from ratings (docs/fandex-score.md §3.7, 2026-10-25).
--
-- A display preference for the score, like user_hidden_items: it never reaches
-- a sync pull (AGENTS.md). `label` is the name as shown when it was followed,
-- so the Follows list can read without the catalog. The user_id column is what
-- makes the table personal: erasure finds it by that name (account.ts), and the
-- export names its columns by hand there.
CREATE TABLE user_facet_follows (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  facet_id    TEXT NOT NULL,
  mode        TEXT NOT NULL,
  label       TEXT NOT NULL,
  followed_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, facet_id)
) WITHOUT ROWID;
