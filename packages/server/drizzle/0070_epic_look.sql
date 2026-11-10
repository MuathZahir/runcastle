ALTER TABLE `sessions` ADD `epic_color` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `epic_icon` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `epic_icon_by_human` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `sessions` SET `epic_color` = (CASE (SELECT COUNT(*) FROM `sessions` AS `s2` WHERE `s2`.`kind` = 'project' AND `s2`.`project_id` IS `sessions`.`project_id` AND (COALESCE(`s2`.`created_at`, 0) < COALESCE(`sessions`.`created_at`, 0) OR (COALESCE(`s2`.`created_at`, 0) = COALESCE(`sessions`.`created_at`, 0) AND `s2`.`rowid` < `sessions`.`rowid`))) % 8 WHEN 0 THEN 'blue' WHEN 1 THEN 'teal' WHEN 2 THEN 'green' WHEN 3 THEN 'olive' WHEN 4 THEN 'amber' WHEN 5 THEN 'rust' WHEN 6 THEN 'rose' ELSE 'violet' END) WHERE `kind` = 'project';
