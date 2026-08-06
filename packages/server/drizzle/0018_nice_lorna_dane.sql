CREATE TABLE `test_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`feature_id` text NOT NULL,
	`lap` integer NOT NULL,
	`text` text NOT NULL,
	`status` text NOT NULL,
	`ticket_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
