ALTER TABLE `features` DROP COLUMN `held_by`;--> statement-breakpoint
ALTER TABLE `features` DROP COLUMN `finish`;--> statement-breakpoint
ALTER TABLE `sessions` ADD `autopilot` integer DEFAULT false NOT NULL;