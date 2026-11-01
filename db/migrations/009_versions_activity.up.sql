-- Этап 1 CMS: история версий товара, журнал активности, корзина для ручных записей.
-- Аддитивная и идемпотентная.
CREATE TABLE IF NOT EXISTS product_versions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id text NOT NULL CHECK (product_id ~ '^[a-z0-9-]{1,60}$'),
  rev integer NOT NULL CHECK (rev >= 1),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  reason text NOT NULL CHECK (reason IN ('save', 'autosave', 'publish', 'unpublish', 'restore', 'import', 'bulk')),
  restored_from_rev integer,
  created_by_user_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, rev)
);

CREATE INDEX IF NOT EXISTS product_versions_product_idx ON product_versions (product_id, created_at DESC);

CREATE TABLE IF NOT EXISTS cms_activity_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  user_id bigint,
  action text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 60),
  entity_type text NOT NULL CHECK (entity_type IN ('product', 'media', 'review', 'webinar', 'entry', 'system')),
  entity_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object')
);

CREATE INDEX IF NOT EXISTS cms_activity_log_at_idx ON cms_activity_log (at DESC);
CREATE INDEX IF NOT EXISTS cms_activity_log_user_idx ON cms_activity_log (user_id, at DESC);
CREATE INDEX IF NOT EXISTS cms_activity_log_action_idx ON cms_activity_log (action, at DESC);
CREATE INDEX IF NOT EXISTS cms_activity_log_entity_idx ON cms_activity_log (entity_type, entity_id, at DESC);

ALTER TABLE cms_entries ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS cms_entries_deleted_idx ON cms_entries (deleted_at) WHERE deleted_at IS NOT NULL;
