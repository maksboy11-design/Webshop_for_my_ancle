ALTER TABLE product_reviews
  ADD COLUMN media jsonb NOT NULL DEFAULT '[]'::jsonb;
