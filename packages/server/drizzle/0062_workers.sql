-- Interactive workers: one row per worker, keyed by its thread's session id
-- (docs/features/interactive-workers). Replaces the prototype's JSON files.
CREATE TABLE `workers` (
	`id` text PRIMARY KEY NOT NULL,
	`feature_id` text NOT NULL,
	`label` text NOT NULL,
	`purpose` text NOT NULL,
	`kind` text NOT NULL,
	`goal` text,
	`done_when` text,
	`model` text NOT NULL,
	`runtime` text NOT NULL,
	`started_by` text NOT NULL,
	`status` text NOT NULL,
	`failure` text,
	`engine` text NOT NULL,
	`container` text,
	`branch` text,
	`feature_branch` text NOT NULL,
	`preview_port` integer,
	`handback_summary` text,
	`handback_commits` text,
	`handback_files` text,
	`outcome` text,
	`outcome_note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workers_feature` ON `workers` (`feature_id`);
