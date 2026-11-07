-- Historical rows remain untouched; unknown snapshots stay NULL.
BEGIN;
ALTER TABLE inventory_transactions ADD COLUMN on_hand_after integer, ADD COLUMN unit_price numeric(14,2);
ALTER TABLE inventory_transactions ADD CONSTRAINT inventory_transaction_snapshots_valid CHECK ((on_hand_after IS NULL OR on_hand_after >= 0) AND (unit_price IS NULL OR unit_price >= 0));
CREATE INDEX inventory_transactions_price_history ON inventory_transactions(unit_price, created_at DESC, id DESC) WHERE unit_price IS NOT NULL;
COMMIT;
