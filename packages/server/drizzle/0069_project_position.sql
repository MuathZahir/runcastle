ALTER TABLE `projects` ADD `position` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `projects` SET `position` = (SELECT COUNT(*) FROM `projects` AS `p2` WHERE `p2`.`rowid` < `projects`.`rowid`);
