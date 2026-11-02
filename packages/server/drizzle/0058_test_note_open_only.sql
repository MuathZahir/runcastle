-- Test notes keep one status, `open` (small-fixes-before-publish, spec "5 and 6").
-- Nothing writes `done`, `promoted` or `carried` any more. Such a note was dealt
-- with long ago, so it is stamped sent: it reads as open again but is never sent.
UPDATE `test_notes`
SET `sent_at` = COALESCE(`sent_at`, `created_at`)
WHERE `status` IN ('done', 'promoted', 'carried');--> statement-breakpoint
UPDATE `test_notes`
SET `status` = 'open'
WHERE `status` IN ('done', 'promoted', 'carried');
