-- ВНИМАНИЕ: удаляет ручные записи Mini App и категории вебинаров. Автоматически не запускается.
DROP TABLE IF EXISTS cms_entries;
ALTER TABLE webinars DROP COLUMN IF EXISTS category;
