ALTER TABLE `events` DROP COLUMN `lap`;--> statement-breakpoint
ALTER TABLE `features` DROP COLUMN `lap`;--> statement-breakpoint
ALTER TABLE `features` DROP COLUMN `tickets_ready_lap`;--> statement-breakpoint
ALTER TABLE `features` DROP COLUMN `phase`;--> statement-breakpoint
ALTER TABLE `ready_declarations` DROP COLUMN `what_to_test`;--> statement-breakpoint
ALTER TABLE `review_findings` DROP COLUMN `lap`;--> statement-breakpoint
ALTER TABLE `review_findings` DROP COLUMN `carried_lap`;--> statement-breakpoint
ALTER TABLE `sessions` DROP COLUMN `lap`;--> statement-breakpoint
ALTER TABLE `test_notes` DROP COLUMN `lap`;--> statement-breakpoint
ALTER TABLE `test_notes` DROP COLUMN `carried_lap`;--> statement-breakpoint
ALTER TABLE `tickets` DROP COLUMN `lap`;--> statement-breakpoint
UPDATE `review_findings` SET `status` = 'open' WHERE `status` = 'carried';