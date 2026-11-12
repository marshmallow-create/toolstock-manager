BEGIN;
ALTER TABLE inventory_transactions ALTER COLUMN unit_price TYPE DECIMAL(24,8);
ALTER TABLE inventory_transactions
 ADD COLUMN amount DECIMAL(24,2),
 ADD COLUMN purchase_unit_price DECIMAL(14,2),
 ADD COLUMN cost_units_per_order INTEGER,
 ADD COLUMN stock_unit TEXT,
 ADD COLUMN cost_basis TEXT NOT NULL DEFAULT 'LEGACY';
ALTER TABLE inventory_transactions ADD CONSTRAINT inventory_cost_basis_valid CHECK (cost_basis IN ('LEGACY','MASTER'));
ALTER TABLE inventory_transactions DISABLE TRIGGER inventory_history_immutable;
UPDATE inventory_transactions SET amount = round(unit_price * quantity, 2) WHERE unit_price IS NOT NULL;
-- Reversals always undo the recorded value, including historical rounding.
UPDATE inventory_transactions reversal SET amount = -original.amount
FROM inventory_transactions original WHERE reversal.reverses_id = original.id;

ALTER TABLE inventory_transactions ENABLE TRIGGER inventory_history_immutable;
COMMIT;
