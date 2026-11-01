-- Откат 009: удаляет историю версий и журнал; снимает пометку корзины у cms_entries. Автоматически не запускается.
DROP INDEX IF EXISTS cms_entries_deleted_idx;
ALTER TABLE cms_entries DROP COLUMN IF EXISTS deleted_at;
DROP TABLE IF EXISTS cms_activity_log;
DROP TABLE IF EXISTS product_versions;
