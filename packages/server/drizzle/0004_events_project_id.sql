CREATE TABLE `__new_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`feature_id` text,
	`run_id` text,
	`ticket_id` text,
	`ts` integer NOT NULL,
	`type` text NOT NULL,
	`message` text NOT NULL,
	`data` text
);
--> statement-breakpoint
INSERT INTO `__new_events` (`id`, `project_id`, `feature_id`, `run_id`, `ticket_id`, `ts`, `type`, `message`, `data`)
SELECT
	`id`,
	COALESCE((SELECT `project_id` FROM `features` WHERE `features`.`id` = `events`.`feature_id`), `feature_id`),
	CASE WHEN `feature_id` IN (SELECT `id` FROM `features`) THEN `feature_id` ELSE NULL END,
	`run_id`,
	`ticket_id`,
	`ts`,
	`type`,
	`message`,
	`data`
FROM `events`;
--> statement-breakpoint
DROP TABLE `events`;
--> statement-breakpoint
ALTER TABLE `__new_events` RENAME TO `events`;
