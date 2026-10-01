CREATE TABLE `feature_dependencies` (
	`dependent_id` text NOT NULL,
	`dependency_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`dependent_id`, `dependency_id`),
	FOREIGN KEY (`dependent_id`) REFERENCES `features`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dependency_id`) REFERENCES `features`(`id`) ON UPDATE no action ON DELETE cascade
);
