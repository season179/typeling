CREATE TABLE seasons_next (
	slug TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	theme TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

INSERT INTO seasons_next (slug, name, theme, created_at, updated_at)
SELECT
	slug,
	CASE slug
		WHEN 'winni-s1' THEN 'The Rainbow Door'
		WHEN 'zack-s1' THEN 'Pixel''s Science Garden'
		ELSE theme
	END,
	theme,
	created_at,
	updated_at
FROM seasons;

CREATE TABLE episodes_next (
	season_slug TEXT NOT NULL,
	idx INTEGER NOT NULL,
	text TEXT NOT NULL,
	text_hash TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (season_slug, idx),
	FOREIGN KEY (season_slug) REFERENCES seasons(slug) ON DELETE CASCADE
) STRICT;

INSERT INTO episodes_next (
	season_slug,
	idx,
	text,
	text_hash,
	created_at,
	updated_at
)
SELECT season_slug, idx, text, text_hash, created_at, updated_at
FROM episodes;

DROP TABLE episodes;
DROP TABLE seasons;

ALTER TABLE seasons_next RENAME TO seasons;
ALTER TABLE episodes_next RENAME TO episodes;

CREATE INDEX episodes_season_idx ON episodes(season_slug, idx);
