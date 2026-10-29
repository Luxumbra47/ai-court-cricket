-- Freeze the exact rules and facts used by each match for deterministic historical replay.
ALTER TABLE `matches` ADD COLUMN `caseSnapshot` JSON NULL;
