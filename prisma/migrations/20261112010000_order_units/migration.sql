ALTER TABLE tools ADD COLUMN order_unit TEXT NOT NULL DEFAULT '個', ADD COLUMN units_per_order INTEGER NOT NULL DEFAULT 1;
UPDATE tools SET order_unit = unit;
ALTER TABLE tools ADD CONSTRAINT tools_units_per_order_positive CHECK (units_per_order > 0);
