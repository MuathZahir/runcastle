ALTER TABLE `sessions` ADD `limit_wake_at` integer;--> statement-breakpoint
ALTER TABLE `sessions` ADD `limit_wake_told` integer DEFAULT false NOT NULL;