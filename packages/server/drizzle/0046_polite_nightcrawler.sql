CREATE TABLE `ready_declarations` (
	`id` text PRIMARY KEY NOT NULL,
	`feature_id` text NOT NULL,
	`run_id` text,
	`scenario` text NOT NULL,
	`what_to_test` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `features` ADD `autonomy` text;--> statement-breakpoint
ALTER TABLE `features` ADD `waiting_reason` text;--> statement-breakpoint
ALTER TABLE `features` ADD `last_human_message_at` integer;--> statement-breakpoint
ALTER TABLE `features` ADD `last_dispatch_at` integer;--> statement-breakpoint
ALTER TABLE `projects` ADD `autonomy` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `gates` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `tokens` integer;--> statement-breakpoint
ALTER TABLE `sessions` ADD `token_breakdown` text;--> statement-breakpoint
ALTER TABLE `test_notes` ADD `sent_at` integer;--> statement-breakpoint
ALTER TABLE `tickets` ADD `tokens` integer;--> statement-breakpoint
ALTER TABLE `tickets` ADD `token_breakdown` text;