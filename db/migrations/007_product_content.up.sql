-- Этап 1 CMS: модульный контент товара (черновик и опубликованная версия раздельно).
-- Аддитивная и идемпотентная. Старое хранилище (products.ts, cms_product_overrides, cms_entries) не трогается;
-- сайт читает product_content.published только если запись есть, иначе работает прежний путь.
CREATE TABLE IF NOT EXISTS product_content (
  product_id text PRIMARY KEY CHECK (product_id ~ '^[a-z0-9-]{1,60}$'),
  schema_version integer NOT NULL DEFAULT 2 CHECK (schema_version >= 2),
  draft jsonb NOT NULL DEFAULT '{"schema_version":2,"meta":{},"blocks":[]}'::jsonb CHECK (jsonb_typeof(draft) = 'object'),
  published jsonb CHECK (published IS NULL OR jsonb_typeof(published) = 'object'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'published', 'archived')),
  draft_rev integer NOT NULL DEFAULT 1 CHECK (draft_rev >= 1),
  published_rev integer CHECK (published_rev IS NULL OR published_rev >= 1),
  search_text text NOT NULL DEFAULT '',
  search_tsv tsvector GENERATED ALWAYS AS (to_tsvector('russian', search_text)) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  updated_by_user_id bigint,
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS product_content_status_idx ON product_content (status, updated_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS product_content_deleted_idx ON product_content (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS product_content_search_idx ON product_content USING gin (search_tsv);
