-- Категория вебинара и ручные записи Mini App (кнопка «Добавить»: товары, отзывы, вебинары).
-- Аддитивная и идемпотентная: только ADD COLUMN IF NOT EXISTS и CREATE ... IF NOT EXISTS.
-- Существующие вебинары получают категорию 'products' (не «с врачами»).
ALTER TABLE webinars
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'products'
  CHECK (category IN ('products', 'doctors'));

CREATE TABLE IF NOT EXISTS cms_entries (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('product', 'review', 'webinar')),
  status text NOT NULL CHECK (status IN ('draft', 'published', 'withdrawn')),
  data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id bigint
);

CREATE INDEX IF NOT EXISTS cms_entries_kind_status_idx ON cms_entries (kind, status, updated_at);
