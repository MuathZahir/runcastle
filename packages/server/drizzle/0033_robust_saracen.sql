CREATE TABLE `review_findings` (
	`id` text PRIMARY KEY NOT NULL,
	`feature_id` text NOT NULL,
	`lap` integer NOT NULL,
	`review_ticket_id` text NOT NULL,
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
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `tickets` ADD `origin_finding_id` text;