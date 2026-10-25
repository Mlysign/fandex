-- How a person's match compares with their own ratings, as COUNTS, one row per
-- medium per user (docs/fandex-score.md §9, 2026-10-25). The admin Score page
-- sums these rows over everybody into the goalpost chart, and the odds under a
-- label come from the same sums once there are enough of them.
--
-- No title and no rating is in here. `bins` is twelve counts of
-- (your rating − the match ÷ 10), rounded, from −6 to +5. `labels` is, per
-- label, how many rated titles got it and how many of those were rated 8 or
-- more, as {"sure-thing": [n, nEightPlus], …}. `version` is the score's version
-- the device computed with, so a later change can read its own rows apart.
--
-- A device sends this at most once a day (lib/ScoreProvider.tsx), so a user
-- costs at most five row writes a day. The user_id column is what makes the
-- table personal: erasure finds it by that name (account.ts), and the export
-- names its columns by hand there.
CREATE TABLE score_report (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  medium     TEXT NOT NULL,
  rated      INTEGER NOT NULL,
  bins       TEXT NOT NULL,
  labels     TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 2,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, medium)
) WITHOUT ROWID;
