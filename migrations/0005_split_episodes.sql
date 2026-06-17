-- Episode split 14 -> 28: each original beat becomes two shorter episodes.
--
-- STRICT tables cannot have their CHECK constraints altered in place, so both
-- progress tables are rebuilt (create -> copy -> drop -> rename), the same
-- dance 0002 used. The new bounds are deliberately generous absolute limits
-- that match the single Zod source (MAX_EPISODES_PER_SEASON = 40), so a future
-- change to per-season episode counts needs no further migration.
--
-- user_story_progress.current_episode is the index of the next episode to play
-- (= episodes completed), so old i maps to new 2*i: completing old episodes
-- 0..c-1 equals completing new episodes 0..2c-1, next is new 2c. Edge cases:
-- never-started 0 -> 0, mid-season c -> 2c, finished 14 -> 28 (one past the new
-- last episode, still "complete").
--
-- typing_sessions.episode_idx is left unchanged: it is WPM history (the parent
-- view never surfaces it) and old values <= 13 remain valid under the new <= 39
-- bound. Only the CHECK is widened.

CREATE TABLE user_story_progress_next (
	email TEXT NOT NULL,
	season_slug TEXT NOT NULL,
	current_episode INTEGER NOT NULL DEFAULT 0 CHECK (current_episode >= 0 AND current_episode <= 40),
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (email, season_slug),
	FOREIGN KEY (email) REFERENCES users(email) ON DELETE CASCADE,
	FOREIGN KEY (season_slug) REFERENCES seasons(slug) ON DELETE CASCADE
) STRICT;

INSERT INTO user_story_progress_next (
	email,
	season_slug,
	current_episode,
	created_at,
	updated_at
)
SELECT email, season_slug, current_episode * 2, created_at, updated_at
FROM user_story_progress;

CREATE TABLE typing_sessions_next (
	id TEXT PRIMARY KEY,
	email TEXT NOT NULL,
	season_slug TEXT NOT NULL,
	episode_idx INTEGER NOT NULL CHECK (episode_idx >= 0 AND episode_idx <= 39),
	wpm REAL NOT NULL CHECK (wpm >= 0 AND wpm <= 1000),
	char_count INTEGER NOT NULL CHECK (char_count >= 0 AND char_count <= 10000),
	active_ms INTEGER NOT NULL CHECK (active_ms >= 0 AND active_ms <= 86400000),
	started_at TEXT NOT NULL,
	finished_at TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (email) REFERENCES users(email) ON DELETE CASCADE,
	FOREIGN KEY (season_slug) REFERENCES seasons(slug) ON DELETE CASCADE
) STRICT;

INSERT INTO typing_sessions_next (
	id,
	email,
	season_slug,
	episode_idx,
	wpm,
	char_count,
	active_ms,
	started_at,
	finished_at,
	created_at
)
SELECT
	id,
	email,
	season_slug,
	episode_idx,
	wpm,
	char_count,
	active_ms,
	started_at,
	finished_at,
	created_at
FROM typing_sessions;

DROP TABLE typing_sessions;
DROP TABLE user_story_progress;

ALTER TABLE user_story_progress_next RENAME TO user_story_progress;
ALTER TABLE typing_sessions_next RENAME TO typing_sessions;

CREATE INDEX typing_sessions_user_story_finished_at
ON typing_sessions(email, season_slug, finished_at DESC);
