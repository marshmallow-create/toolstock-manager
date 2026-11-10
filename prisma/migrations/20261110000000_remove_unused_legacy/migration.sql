BEGIN;

-- Serialize with application writes; preserve originals before removing obsolete structure.
LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE tools, inventory_transactions, machines, supplier_items IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  actor uuid;
  archived jsonb;
BEGIN
  archived := jsonb_build_object(
    'machines', COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM machines m), '[]'::jsonb),
    'supplier_items', COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM supplier_items s), '[]'::jsonb),
    'tools', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'tool_code', t.tool_code, 'manufacturer', t.manufacturer, 'model', t.model) ORDER BY t.id) FROM tools t WHERE t.manufacturer <> '' OR t.model <> ''), '[]'::jsonb),
    'transaction_equipment', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'machine_id', t.machine_id) ORDER BY t.id) FROM inventory_transactions t WHERE t.machine_id IS NOT NULL), '[]'::jsonb)
  );
  IF archived <> '{"machines":[],"supplier_items":[],"tools":[],"transaction_equipment":[]}'::jsonb THEN
    SELECT id INTO actor FROM users ORDER BY (role = 'ADMIN') DESC, active DESC, id LIMIT 1;
    IF actor IS NULL THEN
      RAISE EXCEPTION 'Cannot archive legacy data without an existing user. No data has been removed.';
    END IF;
    INSERT INTO audit_logs(id, actor_user_id, action, entity_type, entity_id, details, created_at, updated_at)
    VALUES(gen_random_uuid(), actor, 'LEGACY_SCHEMA_ARCHIVED', 'schema_cleanup', '20261110000000_remove_unused_legacy', archived, now(), now());
  END IF;
END $$;

-- Match the previous read-time fallback exactly; never replace an existing tool price (including zero).
UPDATE tools t
SET unit_price = si.unit_price
FROM supplier_items si JOIN suppliers s ON s.id = si.supplier_id
WHERE t.id = si.tool_id AND t.unit_price IS NULL AND si.preferred AND s.active;

-- Invalidate stale editor versions after the schema changes.
UPDATE tools SET updated_at = clock_timestamp();

ALTER TABLE inventory_transactions DROP COLUMN machine_id;
ALTER TABLE tools DROP COLUMN manufacturer, DROP COLUMN model;
DROP TABLE machines;
DROP TABLE supplier_items;

COMMIT;
