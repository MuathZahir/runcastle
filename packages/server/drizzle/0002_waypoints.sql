CREATE TABLE `waypoints` (
	`id` text PRIMARY KEY NOT NULL,
	`feature_id` text NOT NULL,
	`seq` integer NOT NULL,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`question` text NOT NULL,
	`blocked_by` text NOT NULL,
	`origin_waypoint_id` text,
	`status` text NOT NULL,
	`claimed_by` text,
	`last_session_id` text,
	`summary` text
);
