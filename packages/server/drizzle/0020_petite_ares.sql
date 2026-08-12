CREATE INDEX IF NOT EXISTS `events_project_id_id_idx` ON `events` (`project_id`,`id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `events_feature_id_id_idx` ON `events` (`feature_id`,`id`);