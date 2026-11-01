-- Этап 1 CMS: медиатека и связи товар↔файл. Файлы лежат в Vercel Blob; в БД — только метаданные.
-- Аддитивная и идемпотентная.
CREATE TABLE IF NOT EXISTS media (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('image', 'video', 'document')),
  mime text NOT NULL CHECK (char_length(mime) BETWEEN 3 AND 100),
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  original_name text NOT NULL DEFAULT '' CHECK (char_length(original_name) <= 255),
  title text CHECK (title IS NULL OR char_length(title) <= 200),
  blob_url text NOT NULL CHECK (blob_url ~ '^(https://[a-z0-9.-]+\.blob\.vercel-storage\.com/|/)'),
  variants jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(variants) = 'object'),
  width integer CHECK (width IS NULL OR width > 0),
  height integer CHECK (height IS NULL OR height > 0),
  duration_s numeric(10, 2) CHECK (duration_s IS NULL OR duration_s >= 0),
  status text NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'processing', 'ready', 'failed')),
  error text,
  created_by_user_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS media_sha256_uidx ON media (sha256) WHERE sha256 IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS media_blob_url_uidx ON media (blob_url);
CREATE INDEX IF NOT EXISTS media_kind_created_idx ON media (kind, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS media_status_idx ON media (status, updated_at) WHERE status IN ('uploading', 'processing', 'failed');
CREATE INDEX IF NOT EXISTS media_deleted_idx ON media (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS media_name_idx ON media (lower(original_name) text_pattern_ops);

CREATE TABLE IF NOT EXISTS product_media (
  product_id text NOT NULL CHECK (product_id ~ '^[a-z0-9-]{1,60}$'),
  media_id uuid NOT NULL REFERENCES media (id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('main', 'gallery', 'video', 'document', 'block')),
  block_id text NOT NULL DEFAULT '',
  position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, role, block_id, media_id)
);

CREATE INDEX IF NOT EXISTS product_media_media_idx ON product_media (media_id);
CREATE INDEX IF NOT EXISTS product_media_order_idx ON product_media (product_id, role, position);
