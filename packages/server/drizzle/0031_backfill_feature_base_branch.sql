-- Every feature cut before `base_branch` existed forked from the project's
-- `main_branch` — the only base there was. Record that on the row now, while the
-- column is still there to read: from here on a feature's base is its own, and
-- nothing falls back to a project-level default (decision 4).
--
-- Drafts are excluded by design: a parked feature has cut no branch yet and
-- picks its base at Start, so a null base is the truth about it, not a gap.
UPDATE `features`
SET `base_branch` = (SELECT `main_branch` FROM `projects` WHERE `projects`.`id` = `features`.`project_id`)
WHERE `base_branch` IS NULL AND `status` != 'draft';
