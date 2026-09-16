UPDATE `features`
SET `phase` = CASE
  WHEN `phase` IN ('ideation', 'spec', 'tickets') THEN 'planning'
  WHEN `phase` = 'implementation' THEN 'building'
  ELSE `phase`
END;--> statement-breakpoint
DROP TABLE `gate_overrides`;
