DROP TABLE IF EXISTS webinars;

ALTER TABLE product_reviews
  DROP COLUMN IF EXISTS withdrawn_by_user_id;

UPDATE incoming_content SET kind = 'text' WHERE kind = 'webinar';

ALTER TABLE incoming_content
  DROP CONSTRAINT IF EXISTS incoming_content_kind_check;

ALTER TABLE incoming_content
  ADD CONSTRAINT incoming_content_kind_check
  CHECK (kind IN ('review', 'text', 'image', 'video', 'mixed', 'unsupported', 'empty'));
