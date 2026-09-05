ALTER TABLE `tickets` ADD `pass_kind` text DEFAULT 'review' NOT NULL;
--> statement-breakpoint
ALTER TABLE `tickets` ADD `reviewed_commit` text;
--> statement-breakpoint
ALTER TABLE `tickets` ADD `completed_at` integer;
