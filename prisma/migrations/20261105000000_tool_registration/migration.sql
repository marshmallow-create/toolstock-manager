ALTER TABLE tools ADD COLUMN department TEXT NOT NULL DEFAULT '';
ALTER TABLE tools ADD COLUMN unit_price DECIMAL(14, 2);
ALTER TABLE tools ADD CONSTRAINT tools_unit_price_nonnegative CHECK (unit_price IS NULL OR unit_price >= 0);
