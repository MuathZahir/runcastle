-- The `prepare` session kind is gone (the-orchestrator-prepares-the-project,
-- decision 13): the orchestrator prepares the project itself. Old preparation
-- chats are deleted. What they established lives on in `project_findings` and
-- the project's prepared columns, which this does not touch. No other table
-- references a session row; their events stay on the project timeline.
DELETE FROM `sessions` WHERE `kind` = 'prepare';
