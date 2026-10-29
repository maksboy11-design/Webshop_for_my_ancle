-- Переопределения публичных полей товаров поверх статического каталога (src/data/products.ts).
-- Чисто аддитивная миграция: только новая таблица.
CREATE TABLE IF NOT EXISTS cms_product_overrides (
  product_id text PRIMARY KEY CHECK (product_id ~ '^[a-z0-9-]{1,60}$'),
  overrides jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(overrides) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id bigint
);
