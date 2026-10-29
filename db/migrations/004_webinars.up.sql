-- Вебинары из YouTube-ссылок (режим A) и разрешённых файлов (режим B, только через admin CLI).
-- Строка не удаляется: снятие с сайта ставит status = 'withdrawn' и withdrawn_at.

ALTER TABLE incoming_content
  DROP CONSTRAINT IF EXISTS incoming_content_kind_check;

ALTER TABLE incoming_content
  ADD CONSTRAINT incoming_content_kind_check
  CHECK (kind IN ('review', 'webinar', 'text', 'image', 'video', 'mixed', 'unsupported', 'empty'));

ALTER TABLE product_reviews
  ADD COLUMN withdrawn_by_user_id bigint;

CREATE TABLE webinars (
  id uuid PRIMARY KEY,
  title text CHECK (title IS NULL OR char_length(title) BETWEEN 1 AND 200),
  speaker text CHECK (speaker IS NULL OR char_length(speaker) BETWEEN 1 AND 120),
  event_date date,
  source_type text NOT NULL CHECK (source_type IN ('youtube', 'hosted')),
  youtube_video_id text UNIQUE CHECK (youtube_video_id IS NULL OR youtube_video_id ~ '^[A-Za-z0-9_-]{11}$'),
  start_seconds integer CHECK (start_seconds IS NULL OR start_seconds BETWEEN 0 AND 86400),
  recording_src text CHECK (recording_src IS NULL OR recording_src ~ '^https://[a-z0-9.-]+\.blob\.vercel-storage\.com/'),
  youtube_title text,
  youtube_published_at timestamptz,
  metadata_status text NOT NULL CHECK (
    metadata_status IN ('ok', 'not_configured', 'not_found', 'not_public', 'not_embeddable', 'api_error', 'hosted')
  ),
  status text NOT NULL CHECK (status IN ('pending', 'published', 'rejected', 'withdrawn')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  published_at timestamptz,
  withdrawn_at timestamptz,
  moderator_user_id bigint,
  content_id uuid REFERENCES incoming_content (id),
  source_chat_id bigint,
  source_message_mid text,
  CONSTRAINT webinars_source CHECK (
    (source_type = 'youtube' AND youtube_video_id IS NOT NULL AND recording_src IS NULL)
    OR (source_type = 'hosted' AND recording_src IS NOT NULL)
  ),
  CONSTRAINT webinars_published_title CHECK (status <> 'published' OR (title IS NOT NULL AND published_at IS NOT NULL))
);

CREATE INDEX webinars_status_idx ON webinars (status, created_at);
CREATE INDEX webinars_content_idx ON webinars (content_id);
