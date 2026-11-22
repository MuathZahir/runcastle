-- Autopilot retires (decision 13): before the column goes, mark every open feature of an epic on autopilot. The boot step (services/autopilot-upgrade.ts) reads these marks, moves the ones still at "everything" to "resultOnly" and tells their leads.
INSERT INTO `events` (`project_id`, `feature_id`, `ts`, `type`, `message`, `data`)
SELECT `features`.`project_id`, `features`.`id`, CAST(strftime('%s', 'now') AS INTEGER) * 1000, 'feature.autopilot_retired', 'its epic was on autopilot when autopilot was retired', json_object('epicId', `sessions`.`id`)
FROM `features` JOIN `sessions` ON `sessions`.`id` = `features`.`chat_id`
WHERE `sessions`.`kind` = 'project' AND `sessions`.`autopilot` = 1 AND `features`.`status` IN ('draft', 'active');
--> statement-breakpoint
ALTER TABLE `sessions` DROP COLUMN `autopilot`;
