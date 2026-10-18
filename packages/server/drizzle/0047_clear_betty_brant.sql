ALTER TABLE `features` DROP COLUMN `autonomy`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `autonomy`;--> statement-breakpoint
ALTER TABLE `features` ADD `stopped_at` integer;