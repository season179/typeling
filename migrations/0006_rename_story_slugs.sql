-- Rename story slugs: winni-s1 -> rainbow-door-s1, zack-s1 -> pixel-garden-s1.
--
-- seasons.slug (PRIMARY KEY) is referenced by episodes, user_story_progress,
-- and typing_sessions via FOREIGN KEY (...) REFERENCES seasons(slug)
-- ON DELETE CASCADE. There is no ON UPDATE clause, so a plain
-- `UPDATE seasons SET slug = ...` would leave the children pointing at a missing
-- parent (and a DELETE of the old parent would cascade their rows away). We
-- rename without ever orphaning a child:
--
--   1. Insert the new season row, copying name/theme/created_at from the old one.
--   2. Repoint every child table from the old slug to the new one. The new
--      parent already exists, so each UPDATE is valid even with foreign keys
--      enforced.
--   3. Delete the old season row. All of its children were repointed in step 2,
--      so the ON DELETE CASCADE fires on zero rows -- no unlocked chapters and
--      no WPM history are lost.
--
-- The NOT EXISTS guard and the slug-scoped WHERE clauses make every statement a
-- no-op on a database that never had the old slugs (e.g. a fresh local DB that
-- is later seeded with the new slugs).

-- winni-s1 -> rainbow-door-s1 -------------------------------------------------
INSERT INTO seasons (slug, name, theme, created_at, updated_at)
SELECT 'rainbow-door-s1', name, theme, created_at, CURRENT_TIMESTAMP
FROM seasons
WHERE slug = 'winni-s1'
	AND NOT EXISTS (SELECT 1 FROM seasons WHERE slug = 'rainbow-door-s1');

UPDATE episodes SET season_slug = 'rainbow-door-s1' WHERE season_slug = 'winni-s1';
UPDATE user_story_progress SET season_slug = 'rainbow-door-s1' WHERE season_slug = 'winni-s1';
UPDATE typing_sessions SET season_slug = 'rainbow-door-s1' WHERE season_slug = 'winni-s1';

DELETE FROM seasons WHERE slug = 'winni-s1';

-- zack-s1 -> pixel-garden-s1 --------------------------------------------------
INSERT INTO seasons (slug, name, theme, created_at, updated_at)
SELECT 'pixel-garden-s1', name, theme, created_at, CURRENT_TIMESTAMP
FROM seasons
WHERE slug = 'zack-s1'
	AND NOT EXISTS (SELECT 1 FROM seasons WHERE slug = 'pixel-garden-s1');

UPDATE episodes SET season_slug = 'pixel-garden-s1' WHERE season_slug = 'zack-s1';
UPDATE user_story_progress SET season_slug = 'pixel-garden-s1' WHERE season_slug = 'zack-s1';
UPDATE typing_sessions SET season_slug = 'pixel-garden-s1' WHERE season_slug = 'zack-s1';

DELETE FROM seasons WHERE slug = 'zack-s1';
