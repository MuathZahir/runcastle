ALTER TABLE `events` ADD `lap` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `features` ADD `lap` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `lap` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `tickets` ADD `lap` integer DEFAULT 1 NOT NULL;