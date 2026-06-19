-- Make parent_viewers.email case-insensitive.
--
-- 0007 created the table with a case-SENSITIVE TEXT PRIMARY KEY, but
-- D1ProgressStore.isParentViewer looks it up with a lowercased email. A row
-- inserted by hand with any uppercase (e.g. "Parent@Gmail.com", the casing
-- Google shows) would never match the lookup, permanently 403-ing the intended
-- parent with no app-side way to fix it.
--
-- 0007 is already applied (and SQLite cannot ALTER a column's collation), so we
-- rebuild the table here with `COLLATE NOCASE` instead of editing 0007 in place
-- (which would leave already-migrated databases diverging from the file). Any
-- existing allowlist rows are copied across, so no manual reinsert is needed.
CREATE TABLE parent_viewers_next (
	email TEXT PRIMARY KEY COLLATE NOCASE,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

INSERT INTO parent_viewers_next (email, created_at)
SELECT email, created_at FROM parent_viewers;

DROP TABLE parent_viewers;

ALTER TABLE parent_viewers_next RENAME TO parent_viewers;
