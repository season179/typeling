CREATE TABLE users (
	email TEXT PRIMARY KEY,
	display_name TEXT NOT NULL,
	name TEXT,
	access_subject TEXT,
	target_wpm INTEGER NOT NULL DEFAULT 15 CHECK (target_wpm >= 1 AND target_wpm <= 1000),
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE TABLE user_story_progress (
	email TEXT NOT NULL,
	season_slug TEXT NOT NULL,
	current_episode INTEGER NOT NULL DEFAULT 0 CHECK (current_episode >= 0 AND current_episode <= 14),
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (email, season_slug),
	FOREIGN KEY (email) REFERENCES users(email) ON DELETE CASCADE,
	FOREIGN KEY (season_slug) REFERENCES seasons(slug) ON DELETE CASCADE
) STRICT;

CREATE TABLE typing_sessions (
	id TEXT PRIMARY KEY,
	email TEXT NOT NULL,
	season_slug TEXT NOT NULL,
	episode_idx INTEGER NOT NULL CHECK (episode_idx >= 0 AND episode_idx <= 13),
	wpm REAL NOT NULL CHECK (wpm >= 0 AND wpm <= 1000),
	char_count INTEGER NOT NULL CHECK (char_count >= 0 AND char_count <= 10000),
	active_ms INTEGER NOT NULL CHECK (active_ms >= 0 AND active_ms <= 86400000),
	started_at TEXT NOT NULL,
	finished_at TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (email) REFERENCES users(email) ON DELETE CASCADE,
	FOREIGN KEY (season_slug) REFERENCES seasons(slug) ON DELETE CASCADE
) STRICT;

CREATE INDEX typing_sessions_user_story_finished_at
ON typing_sessions(email, season_slug, finished_at DESC);
