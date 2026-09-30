UPDATE `sessions` SET `kind` = 'chat', `cc_session_id` = NULL WHERE `kind` IN ('waypoint','converge');--> statement-breakpoint
DROP TABLE `waypoints`;--> statement-breakpoint
ALTER TABLE `features` DROP COLUMN `mapped`;
