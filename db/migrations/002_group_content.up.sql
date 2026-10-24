ALTER TABLE product_reviews
  ADD COLUMN withdrawn_at timestamptz;

ALTER TABLE product_reviews
  ALTER COLUMN sender_user_id DROP NOT NULL;

CREATE TABLE incoming_content (
  id uuid PRIMARY KEY,
  chat_id bigint NOT NULL,
  message_mid text NOT NULL,
  received_at timestamptz NOT NULL,
  edited_at timestamptz,
  kind text NOT NULL CHECK (kind IN ('review', 'text', 'image', 'video', 'mixed', 'unsupported', 'empty')),
  body_text text,
  public_text text,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL CHECK (status IN ('pending', 'published', 'rejected', 'removed', 'empty')),
  idempotency_key text NOT NULL UNIQUE,
  published_review_id uuid REFERENCES product_reviews (id),
  UNIQUE (chat_id, message_mid)
);

CREATE INDEX incoming_content_pending_idx
  ON incoming_content (received_at)
  WHERE status = 'pending' AND kind = 'review';
