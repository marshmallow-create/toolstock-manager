BEGIN;
ALTER TABLE tools DROP COLUMN unit, DROP COLUMN order_unit;
ALTER TABLE tool_orders DROP COLUMN order_unit;
ALTER TABLE inventory_transactions DROP COLUMN stock_unit;
COMMIT;
