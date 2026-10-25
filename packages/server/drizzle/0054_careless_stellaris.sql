ALTER TABLE `features` DROP COLUMN `orchestrated`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `orchestrator`;--> statement-breakpoint
UPDATE `sessions` SET `purpose` = NULL WHERE `purpose` = 'orchestrate';
