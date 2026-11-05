-- Consolidate application roles without granting additional privileges.
-- Keep historical migrations unchanged; preserve user identities and history.
BEGIN;
LOCK TABLE users IN ACCESS EXCLUSIVE MODE;
LOCK TABLE sessions IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM users WHERE role::text NOT IN ('WORKER', 'ADMIN'))
    AND NOT EXISTS (SELECT 1 FROM users WHERE role::text = 'ADMIN') THEN
  RAISE EXCEPTION 'Role migration requires an existing administrator';
 END IF;
END $$;

WITH migration_actor AS (
 SELECT id FROM users WHERE role::text = 'ADMIN'
 ORDER BY active DESC, created_at, id LIMIT 1
)
INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, details, created_at, updated_at)
SELECT gen_random_uuid(), migration_actor.id, 'USER_ROLE_MIGRATED', 'users', target.id::text,
 jsonb_build_object(
  'before', jsonb_build_object('role', target.role::text),
  'after', jsonb_build_object('role', 'WORKER'),
  'reason', '20261105010000_two_roles'
 ), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM users AS target CROSS JOIN migration_actor
WHERE target.role::text NOT IN ('WORKER', 'ADMIN');

DELETE FROM sessions WHERE user_id IN (
 SELECT id FROM users WHERE role::text NOT IN ('WORKER', 'ADMIN')
);
UPDATE users SET updated_at = CURRENT_TIMESTAMP
WHERE role::text NOT IN ('WORKER', 'ADMIN');

CREATE TYPE "Role_next" AS ENUM ('WORKER', 'ADMIN');
ALTER TABLE users ALTER COLUMN role TYPE "Role_next"
USING (CASE WHEN role::text = 'ADMIN' THEN 'ADMIN' ELSE 'WORKER' END)::"Role_next";
DROP TYPE "Role";
ALTER TYPE "Role_next" RENAME TO "Role";
COMMIT;
