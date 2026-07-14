CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`feature_id` text NOT NULL,
	`run_id` text,
	`ticket_id` text,
	`ts` integer NOT NULL,
	`type` text NOT NULL,
	`message` text NOT NULL,
	`data` text
);
--> statement-breakpoint
CREATE TABLE `features` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`one_liner` text NOT NULL,
	`size` text NOT NULL,
	`phase` text NOT NULL,
	`branch` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `gate_overrides` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`feature_id` text NOT NULL,
	`gate` text NOT NULL,
	`reason` text NOT NULL,
	`ts` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`repo_path` text NOT NULL,
	`main_branch` text NOT NULL,
	`dev_command` text
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`feature_id` text NOT NULL,
	`workflow` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`summary` text
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`feature_id` text NOT NULL,
	`kind` text NOT NULL,
	`cc_session_id` text,
	`transcript_path` text,
	`status` text NOT NULL,
	`worktree_path` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`feature_id` text NOT NULL,
	`seq` integer NOT NULL,
	`title` text NOT NULL,
	`goal` text NOT NULL,
	`context` text NOT NULL,
	`acceptance_criteria` text NOT NULL,
	`seams` text NOT NULL,
	`blocked_by` text NOT NULL,
	`status` text NOT NULL,
	`commits` text NOT NULL,
	`error` text
);
