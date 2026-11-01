-- Откат 010: удаляет таблицы страниц и их версий, возвращает прежний список entity_type журнала
-- (NOT VALID — уже записанные строки 'page' не мешают откату). Автоматически не запускается.
DO $$
BEGIN
  IF to_regclass('public.cms_activity_log') IS NOT NULL THEN
    ALTER TABLE cms_activity_log DROP CONSTRAINT IF EXISTS cms_activity_log_entity_type_check;
    ALTER TABLE cms_activity_log ADD CONSTRAINT cms_activity_log_entity_type_check
      CHECK (entity_type IN ('product', 'media', 'review', 'webinar', 'entry', 'system')) NOT VALID;
  END IF;
END $$;
DROP TABLE IF EXISTS page_versions;
DROP TABLE IF EXISTS pages;
