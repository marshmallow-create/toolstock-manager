-- Retain historical rows and equipment references; new issues need no equipment.
BEGIN;
ALTER TABLE "inventory_transactions" DROP CONSTRAINT "inventory_transactions_valid";
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_valid" CHECK (
 quantity <> 0
 AND (type <> 'ISSUE' OR quantity < 0)
 AND (type <> 'RECEIVE' OR quantity > 0)
 AND (type NOT IN ('ADJUSTMENT','REVERSAL') OR (reason IS NOT NULL AND length(trim(reason)) > 0))
 AND (type <> 'REVERSAL' OR reverses_id IS NOT NULL)
);
COMMIT;
