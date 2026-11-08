PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_workers` (
	`id` text PRIMARY KEY NOT NULL,
	`feature_id` text,
	`project_id` text NOT NULL,
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
	`dev_server` integer DEFAULT false NOT NULL,
	`handback_summary` text,
	`handback_commits` text,
	`handback_files` text,
	`outcome` text,
	`outcome_note` text,
	`tokens` integer,
	`review_mode` text,
	`review_verify` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_workers`("id", "feature_id", "project_id", "label", "purpose", "kind", "goal", "done_when", "model", "runtime", "started_by", "status", "failure", "engine", "container", "branch", "feature_branch", "preview_port", "dev_server", "handback_summary", "handback_commits", "handback_files", "outcome", "outcome_note", "tokens", "review_mode", "review_verify", "created_at", "updated_at") SELECT `workers`."id", `workers`."feature_id", `features`."project_id", `workers`."label", `workers`."purpose", `workers`."kind", `workers`."goal", `workers`."done_when", `workers`."model", `workers`."runtime", `workers`."started_by", `workers`."status", `workers`."failure", `workers`."engine", `workers`."container", `workers`."branch", `workers`."feature_branch", `workers`."preview_port", `workers`."dev_server", `workers`."handback_summary", `workers`."handback_commits", `workers`."handback_files", `workers`."outcome", `workers`."outcome_note", `workers`."tokens", `workers`."review_mode", `workers`."review_verify", `workers`."created_at", `workers`."updated_at" FROM `workers` INNER JOIN `features` ON `features`."id" = `workers`."feature_id";--> statement-breakpoint
DROP TABLE `workers`;--> statement-breakpoint
ALTER TABLE `__new_workers` RENAME TO `workers`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `workers_feature` ON `workers` (`feature_id`);--> statement-breakpoint
CREATE INDEX `workers_project` ON `workers` (`project_id`);