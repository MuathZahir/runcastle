-- The whole usage signal: one row per install per day, so repeat boots collapse
-- and weekly actives is an exact COUNT(DISTINCT install_id) (see README.md).
CREATE TABLE IF NOT EXISTS pings (
  install_id TEXT NOT NULL,
  day TEXT NOT NULL,
  version TEXT NOT NULL,
  platform TEXT NOT NULL,
  PRIMARY KEY (install_id, day)
);
