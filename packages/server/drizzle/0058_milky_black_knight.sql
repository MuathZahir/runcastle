CREATE TABLE `designs` (
	`id` text PRIMARY KEY NOT NULL,
	`feature_id` text NOT NULL,
	`path` text NOT NULL,
	`title` text NOT NULL,
	`width` integer,
	`picture` text,
	`state` text NOT NULL,
	`approved_by` text,
	`shown_at` integer NOT NULL,
	`seen_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `designs_feature_path` ON `designs` (`feature_id`,`path`);--> statement-breakpoint
ALTER TABLE `features` ADD `plan_shown_at` integer;--> statement-breakpoint
ALTER TABLE `features` ADD `plan_seen_at` integer;