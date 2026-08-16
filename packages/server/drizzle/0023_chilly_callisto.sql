ALTER TABLE `projects` DROP COLUMN `drive_env`;--> statement-breakpoint
DELETE FROM `project_findings` WHERE `key` = 'driveEnv';
