-- Этап 6 CMS: индексы для глобального поиска/фильтров (категория, бренд, тип, даты).
-- Аддитивная и идемпотентная. Данные не меняет и не удаляет.
-- ВНИМАНИЕ: на продакшн применяется только с разрешения владельца.
CREATE INDEX IF NOT EXISTS product_content_created_idx
  ON product_content (created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS product_content_updated_idx
  ON product_content (updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS product_content_meta_category_idx
  ON product_content ((draft #>> '{meta,category}'))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS product_content_meta_brand_idx
  ON product_content ((draft #>> '{meta,brandId}'))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS product_content_meta_kind_idx
  ON product_content ((draft #>> '{meta,kind}'))
  WHERE deleted_at IS NULL;

-- Имена файлов медиатеки: поиск по title + original_name (prefix/ILIKE через lower).
CREATE INDEX IF NOT EXISTS media_title_lower_idx
  ON media (lower(coalesce(title, '')) text_pattern_ops)
  WHERE deleted_at IS NULL;
