DROP TABLE IF EXISTS incoming_content;

DELETE FROM product_reviews WHERE sender_user_id IS NULL;

ALTER TABLE product_reviews
  ALTER COLUMN sender_user_id SET NOT NULL;

ALTER TABLE product_reviews
  DROP COLUMN IF EXISTS withdrawn_at;
