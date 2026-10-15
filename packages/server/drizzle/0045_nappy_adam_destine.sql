ALTER TABLE `features` ADD `orchestrated` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `orchestrator` integer;--> statement-breakpoint
ALTER TABLE `sessions` ADD `headless` integer DEFAULT false NOT NULL;