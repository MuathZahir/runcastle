CREATE TABLE `project_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`text` text NOT NULL,
	`status` text NOT NULL,
	`outcome` text,
	`feature_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
