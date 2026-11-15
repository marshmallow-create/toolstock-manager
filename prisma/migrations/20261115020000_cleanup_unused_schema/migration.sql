BEGIN;

LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE tools, suppliers, purchase_orders, purchase_order_items,
 inventory_policies, tool_orders IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
 actor uuid;
 archived jsonb;
BEGIN
 archived := jsonb_build_object(
  'suppliers', COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM suppliers t), '[]'::jsonb),
  'purchase_orders', COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM purchase_orders t), '[]'::jsonb),
  'purchase_order_items', COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM purchase_order_items t), '[]'::jsonb),
  'inventory_policies', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'tool_id',tool_id,'safety_stock',safety_stock,'target_stock',target_stock) ORDER BY id) FROM inventory_policies), '[]'::jsonb)
 );
 IF archived <> '{"suppliers":[],"purchase_orders":[],"purchase_order_items":[],"inventory_policies":[]}'::jsonb THEN
  SELECT id INTO actor FROM users ORDER BY (role = 'ADMIN') DESC, active DESC, id LIMIT 1;
  IF actor IS NULL THEN
   RAISE EXCEPTION 'Cannot archive retired data without an existing user. No data has been removed.';
  END IF;
  INSERT INTO audit_logs(id,actor_user_id,action,entity_type,entity_id,details,created_at,updated_at)
  VALUES(gen_random_uuid(),actor,'PROJECT_SCHEMA_CLEANUP','schema_cleanup','20261115020000_cleanup_unused_schema',archived,now(),now());
 END IF;
END $$;

-- Legacy outstanding quantities were already stock counts. Preserve them without
-- applying today's pack size, including partial receipts and the original price.
INSERT INTO tool_orders(id,tool_id,created_by,request_key,order_quantity,units_per_order,
 stock_quantity,received_quantity,cancelled_quantity,purchase_unit_price,created_at,updated_at)
SELECT gen_random_uuid(),i.tool_id,o.requested_by,'legacy-purchase-item:' || i.id,
 i.ordered_quantity,1,i.ordered_quantity,i.received_quantity,0,i.unit_price,
 COALESCE(o.ordered_at,o.created_at),now()
FROM purchase_order_items i JOIN purchase_orders o ON o.id=i.order_id
WHERE o.status IN ('ORDERED','PARTIALLY_RECEIVED') AND i.ordered_quantity>i.received_quantity;

DROP TABLE purchase_order_items;
DROP TABLE purchase_orders;
DROP TABLE suppliers;
DROP TYPE "OrderStatus";

ALTER TABLE inventory_policies DROP CONSTRAINT inventory_policies_valid;
ALTER TABLE inventory_policies DROP COLUMN safety_stock, DROP COLUMN target_stock;
ALTER TABLE inventory_policies ADD CONSTRAINT inventory_policies_reorder_point_valid CHECK (reorder_point >= 0);

COMMIT;
