-- Раздел «Страницы» (универсальный редактор). Аддитивная и идемпотентная: только новые таблицы и
-- расширение списка entity_type журнала значением 'page'. Существующие данные не меняются и не удаляются.
-- ВНИМАНИЕ: на продакшн применяется только с разрешения владельца.
CREATE TABLE IF NOT EXISTS pages (
  id uuid PRIMARY KEY,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  draft jsonb NOT NULL CHECK (jsonb_typeof(draft) = 'object'),
  published jsonb CHECK (published IS NULL OR jsonb_typeof(published) = 'object'),
  published_title text,
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version >= 1),
  draft_rev integer NOT NULL DEFAULT 0 CHECK (draft_rev >= 0),
  created_by_user_id bigint,
  updated_by_user_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  deleted_at timestamptz
);

-- Слаг уникален среди неудалённых страниц (страница в корзине не держит адрес).
CREATE UNIQUE INDEX IF NOT EXISTS pages_slug_live_uidx ON pages (slug) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS pages_updated_idx ON pages (updated_at DESC);
CREATE INDEX IF NOT EXISTS pages_deleted_idx ON pages (deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS page_versions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  page_id uuid NOT NULL REFERENCES pages (id),
  rev integer NOT NULL CHECK (rev >= 1),
  title text NOT NULL,
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  reason text NOT NULL CHECK (reason IN ('save', 'publish', 'restore', 'import')),
  restored_from_rev integer,
  created_by_user_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (page_id, rev)
);
CREATE INDEX IF NOT EXISTS page_versions_page_idx ON page_versions (page_id, rev DESC);

-- Журнал активности: добавить 'page' в допустимые entity_type (список только расширяется).
DO $$
BEGIN
  IF to_regclass('public.cms_activity_log') IS NOT NULL THEN
    ALTER TABLE cms_activity_log DROP CONSTRAINT IF EXISTS cms_activity_log_entity_type_check;
    ALTER TABLE cms_activity_log ADD CONSTRAINT cms_activity_log_entity_type_check
      CHECK (entity_type IN ('product', 'media', 'review', 'webinar', 'entry', 'system', 'page'));
  END IF;
END $$;
