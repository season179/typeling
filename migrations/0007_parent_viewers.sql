-- Parent-viewer allowlist for the /parent stats dashboard.
--
-- Every Google account in Typeling is a kid; there is no parent account. The
-- parent views all kids at /parent only if their signed-in email appears in
-- this table. The deployed Worker ONLY reads this table -- there is no app
-- route to modify it. Membership is managed exclusively from a local machine
-- via `wrangler d1 execute --remote "INSERT/DELETE ... parent_viewers"`, so
-- access cannot be granted from the deployed app. No emails are committed to
-- source: this migration creates the table empty.
CREATE TABLE parent_viewers (
	email TEXT PRIMARY KEY,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
