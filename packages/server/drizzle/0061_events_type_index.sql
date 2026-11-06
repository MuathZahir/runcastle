-- The token count reads each conversation's launch records — `session.launching`
-- and `session.purpose_set` events — at every turn's end (honest-token-counts,
-- decisions 1 and 3). The events table only grows, so the lookup goes by type.
CREATE INDEX `events_type_idx` ON `events` (`type`);
