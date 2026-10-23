-- A provider id that answered under another id: an Open Library work merged
-- into another, a Hardcover duplicate followed to its canonical book, an IGDB
-- port opened as its main game. The item is stored under the id that answered,
-- so without this row the id that was ASKED misses on every lookup and every
-- library sync fetches it from the provider again.
--
-- A catalog table: no user_id, so erasure leaves it alone. One row write each,
-- the primary key is the only b-tree. Rows go when the item does.
CREATE TABLE provider_aliases (
  source        TEXT NOT NULL,
  source_id     TEXT NOT NULL,
  media_type    TEXT NOT NULL,
  media_item_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  PRIMARY KEY (source, source_id, media_type)
) WITHOUT ROWID;
