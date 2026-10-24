CREATE TABLE max_update_receipts (
  idempotency_key text PRIMARY KEY,
  update_type text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE review_sessions (
  user_id bigint PRIMARY KEY,
  step text NOT NULL CHECK (step IN ('choose_product', 'enter_text', 'enter_name', 'consent')),
  product_id text,
  draft_text text,
  author_name text,
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE product_reviews (
  id uuid PRIMARY KEY,
  product_id text NOT NULL,
  body text NOT NULL,
  author_name text,
  status text NOT NULL CHECK (status IN ('pending', 'published', 'rejected')),
  source text NOT NULL CHECK (source = 'MAX'),
  received_at timestamptz NOT NULL,
  consent_at timestamptz NOT NULL,
  decided_at timestamptz,
  moderator_user_id bigint,
  idempotency_key text NOT NULL UNIQUE,
  sender_user_id bigint NOT NULL,
  CONSTRAINT product_reviews_decision CHECK (
    (status = 'pending' AND decided_at IS NULL AND moderator_user_id IS NULL)
    OR (status IN ('published', 'rejected') AND decided_at IS NOT NULL AND moderator_user_id IS NOT NULL)
  )
);

CREATE INDEX product_reviews_pending_idx ON product_reviews (received_at) WHERE status = 'pending';
CREATE INDEX product_reviews_published_idx ON product_reviews (product_id, received_at) WHERE status = 'published';

CREATE TABLE review_outbox (
  id uuid PRIMARY KEY,
  idempotency_key text NOT NULL REFERENCES max_update_receipts (idempotency_key),
  position integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('message', 'callback_answer')),
  chat_id bigint,
  user_id bigint,
  callback_id text,
  body_text text,
  attachments jsonb,
  notification text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sending_at timestamptz
);

CREATE INDEX review_outbox_key_idx ON review_outbox (idempotency_key, position);

CREATE TABLE review_intake_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id bigint NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX review_intake_events_user_idx ON review_intake_events (user_id, created_at);
