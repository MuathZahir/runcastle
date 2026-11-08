PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_review_findings` (
	`id` text PRIMARY KEY NOT NULL,
	`feature_id` text NOT NULL,
	`review_ticket_id` text,
	`review_worker_id` text,
	`kind` text NOT NULL,
	`severity` text NOT NULL,
	`title` text NOT NULL,
	`location` text NOT NULL,
	`citation` text NOT NULL,
	`detail` text NOT NULL,
	`repro_step` text NOT NULL,
	`status` text NOT NULL,
	`open_reason` text,
	`failure_reason` text,
	`fix_ticket_id` text,
	`resolved_by` text,
	`resolution_note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_review_findings`("id", "feature_id", "review_ticket_id", "review_worker_id", "kind", "severity", "title", "location", "citation", "detail", "repro_step", "status", "open_reason", "failure_reason", "fix_ticket_id", "resolved_by", "resolution_note", "created_at") SELECT "id", "feature_id", "review_ticket_id", NULL, "kind", "severity", "title", "location", "citation", "detail", "repro_step", "status", "open_reason", "failure_reason", "fix_ticket_id", "resolved_by", "resolution_note", "created_at" FROM `review_findings`;--> statement-breakpoint
DROP TABLE `review_findings`;--> statement-breakpoint
ALTER TABLE `__new_review_findings` RENAME TO `review_findings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `workers` ADD `review_mode` text;--> statement-breakpoint
ALTER TABLE `workers` ADD `review_verify` text;