PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`feature_id` text,
	`project_id` text,
	`kind` text NOT NULL,
	`cc_session_id` text,
	`transcript_path` text,
	`status` text NOT NULL,
	`worktree_path` text NOT NULL
);
--> statement-breakpoint
-- `project_id` is NEW in this migration, so it is deliberately absent from the
-- SELECT: the old `sessions` table has no such column and drizzle's generated
-- statement named it on both sides, which fails with "no such column". Existing
-- rows are all feature sessions and correctly take NULL here — they derive
-- their project through `feature_id` exactly as before.
INSERT INTO `__new_sessions`("id", "feature_id", "kind", "cc_session_id", "transcript_path", "status", "worktree_path") SELECT "id", "feature_id", "kind", "cc_session_id", "transcript_path", "status", "worktree_path" FROM `sessions`;--> statement-breakpoint
DROP TABLE `sessions`;--> statement-breakpoint
ALTER TABLE `__new_sessions` RENAME TO `sessions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;