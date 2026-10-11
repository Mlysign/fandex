-- The taxonomy proposals an admin said no to (Scoring admin, Taxonomy, Review).
--
-- The proposals themselves are not stored anywhere. The app works them out from
-- the catalog each time the Review section opens, which is the only way they
-- stay true as the catalog changes. An accepted one stops proposing itself: the
-- tag is no longer in Other, the franchise is no longer separate. A denied one
-- would come back on every sweep unless the denial is written down, and this is
-- where it is written down.
--
-- kind is tag-category, franchise-merge or franchise-member. ref is the rule id,
-- alias>canonical, or mediaItemId>ipKey: the same strings the old site stored,
-- so its 34 rows carry over as they are.
--
-- The natural key is the primary key of a WITHOUT ROWID table, so a denial is
-- one row write. No user_id: this is catalog curation, not a person's data.
-- Comments are plain prose on purpose: this file is passed to D1 as-is.

CREATE TABLE taxonomy_suggestion_dismissed (
  kind       TEXT NOT NULL,
  ref        TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (kind, ref)
) WITHOUT ROWID;
