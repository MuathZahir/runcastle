CREATE TABLE `project_findings` (
	`project_id` text NOT NULL,
	`key` text NOT NULL,
	`source` text NOT NULL,
	`evidence` text,
	`established_at` integer NOT NULL,
	`established_sha` text,
	PRIMARY KEY(`project_id`, `key`)
);
--> statement-breakpoint
CREATE TABLE `project_preps` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`summary` text,
	`head_sha` text
);
--> statement-breakpoint
ALTER TABLE `projects` ADD `setup_command` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `verify_commands` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `known_failures` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `db_reset_command` text;