UPDATE `sessions`
SET `kind` = 'chat'
WHERE `kind` IN ('ideation', 'qa', 'revisit');
