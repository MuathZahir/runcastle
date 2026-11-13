ALTER TABLE `sessions` ADD `wait_why` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `wait_since` integer;--> statement-breakpoint
ALTER TABLE `sessions` ADD `wait_by` text;--> statement-breakpoint
UPDATE `sessions` SET `wait_why` = (SELECT `f`.`waiting_reason` FROM `features` AS `f` WHERE `f`.`id` = `sessions`.`feature_id`), `wait_since` = CAST(strftime('%s','now') AS integer) * 1000, `wait_by` = 'agent' WHERE `kind` = 'chat' AND `rowid` = (SELECT MAX(`s2`.`rowid`) FROM `sessions` AS `s2` WHERE `s2`.`kind` = 'chat' AND `s2`.`feature_id` = `sessions`.`feature_id`) AND EXISTS (SELECT 1 FROM `features` AS `f` WHERE `f`.`id` = `sessions`.`feature_id` AND `f`.`status` = 'active' AND `f`.`waiting_reason` IS NOT NULL AND `f`.`waiting_reason` NOT IN ('stopped', 'planning stopped', 'provider limit', 'ready to test') AND COALESCE(`f`.`waiting_kind`, 'answer') <> 'stuck');--> statement-breakpoint
ALTER TABLE `features` DROP COLUMN `waiting_reason`;--> statement-breakpoint
ALTER TABLE `features` DROP COLUMN `waiting_kind`;--> statement-breakpoint
ALTER TABLE `features` DROP COLUMN `handback_at`;--> statement-breakpoint
ALTER TABLE `features` DROP COLUMN `handback_summary`;