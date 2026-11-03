-- Phase 1: all timestamps UTC, restrictive references.
CREATE TYPE "Role" AS ENUM ('WORKER', 'STOCK_MANAGER', 'PURCHASER', 'ADMIN');
CREATE TYPE "TransactionType" AS ENUM ('RECEIVE', 'ISSUE', 'ADJUSTMENT', 'REVERSAL', 'RETURN');
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'EXPORTED', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'REJECTED', 'CANCELLED');
CREATE TYPE "CandidateStatus" AS ENUM ('OPEN', 'CONVERTED', 'DISMISSED');
CREATE TABLE "users" (
 "id" UUID PRIMARY KEY,
 "employee_code" TEXT NOT NULL UNIQUE,
 "name" TEXT NOT NULL,
 "role" "Role" NOT NULL,
 "active" BOOLEAN NOT NULL DEFAULT true,
 "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updated_at" TIMESTAMPTZ(3) NOT NULL
);
CREATE TABLE "tools" (
 "id" UUID PRIMARY KEY,
 "tool_code" TEXT NOT NULL UNIQUE,
 "name" TEXT NOT NULL,
 "category" TEXT NOT NULL,
 "manufacturer" TEXT NOT NULL,
 "model" TEXT NOT NULL,
 "unit" TEXT NOT NULL,
 "active" BOOLEAN NOT NULL DEFAULT true,
 "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updated_at" TIMESTAMPTZ(3) NOT NULL
);
CREATE TABLE "machines" (
 "id" UUID PRIMARY KEY,
 "machine_code" TEXT NOT NULL UNIQUE,
 "name" TEXT NOT NULL,
 "active" BOOLEAN NOT NULL DEFAULT true,
 "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updated_at" TIMESTAMPTZ(3) NOT NULL
);
CREATE TABLE "locations" (
 "id" UUID PRIMARY KEY,
 "location_code" TEXT NOT NULL UNIQUE,
 "name" TEXT NOT NULL,
 "active" BOOLEAN NOT NULL DEFAULT true,
 "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updated_at" TIMESTAMPTZ(3) NOT NULL
);
CREATE TABLE "stock_balances" (
 "id" UUID PRIMARY KEY,
 "tool_id" UUID NOT NULL,
 "location_id" UUID NOT NULL,
 "on_hand" INTEGER NOT NULL DEFAULT 0,
 "reserved" INTEGER NOT NULL DEFAULT 0,
 "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updated_at" TIMESTAMPTZ(3) NOT NULL
);
CREATE TABLE "inventory_transactions" (
 "id" UUID PRIMARY KEY,
 "tool_id" UUID NOT NULL,
 "location_id" UUID NOT NULL,
 "actor_user_id" UUID NOT NULL,
 "machine_id" UUID,
 "type" "TransactionType" NOT NULL,
 "quantity" INTEGER NOT NULL,
 "idempotency_key" TEXT NOT NULL UNIQUE,
 "reverses_id" UUID UNIQUE,
 "reason" TEXT,
 "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updated_at" TIMESTAMPTZ(3) NOT NULL
);
CREATE TABLE "inventory_policies" (
 "id" UUID PRIMARY KEY,
 "tool_id" UUID NOT NULL UNIQUE,
 "safety_stock" INTEGER NOT NULL,
 "reorder_point" INTEGER NOT NULL,
 "target_stock" INTEGER NOT NULL,
 "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updated_at" TIMESTAMPTZ(3) NOT NULL
);
CREATE TABLE "suppliers" (
 "id" UUID PRIMARY KEY,
 "supplier_code" TEXT NOT NULL UNIQUE,
 "name" TEXT NOT NULL,
 "email" TEXT,
 "active" BOOLEAN NOT NULL DEFAULT true,
 "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updated_at" TIMESTAMPTZ(3) NOT NULL
);
CREATE TABLE "supplier_items" (
 "id" UUID PRIMARY KEY,
 "tool_id" UUID NOT NULL,
 "supplier_id" UUID NOT NULL,
 "supplier_model" TEXT,
 "unit_price" NUMERIC(14,2) NOT NULL,
 "order_multiple" INTEGER NOT NULL,
 "lead_time_days" INTEGER NOT NULL,
 "preferred" BOOLEAN NOT NULL DEFAULT false,
 "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updated_at" TIMESTAMPTZ(3) NOT NULL
);
CREATE TABLE "purchase_orders" (
 "id" UUID PRIMARY KEY,
 "order_no" TEXT NOT NULL UNIQUE,
 "supplier_id" UUID NOT NULL,
 "status" "OrderStatus" NOT NULL,
 "requested_by" UUID NOT NULL,
 "approved_by" UUID,
 "ordered_at" TIMESTAMPTZ(3),
 "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updated_at" TIMESTAMPTZ(3) NOT NULL
);
CREATE TABLE "purchase_order_items" (
 "id" UUID PRIMARY KEY,
 "order_id" UUID NOT NULL,
 "tool_id" UUID NOT NULL,
 "ordered_quantity" INTEGER NOT NULL,
 "received_quantity" INTEGER NOT NULL DEFAULT 0,
 "unit_price" NUMERIC(14,2) NOT NULL,
 "supplier_model" TEXT NOT NULL,
 "order_multiple" INTEGER NOT NULL,
 "lead_time_days" INTEGER NOT NULL,
 "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updated_at" TIMESTAMPTZ(3) NOT NULL
);
CREATE TABLE "reorder_candidates" (
 "id" UUID PRIMARY KEY,
 "tool_id" UUID NOT NULL,
 "status" "CandidateStatus" NOT NULL,
 "quantity" INTEGER NOT NULL,
 "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updated_at" TIMESTAMPTZ(3) NOT NULL
);
CREATE TABLE "audit_logs" (
 "id" UUID PRIMARY KEY,
 "actor_user_id" UUID NOT NULL,
 "action" TEXT NOT NULL,
 "entity_type" TEXT NOT NULL,
 "entity_id" TEXT NOT NULL,
 "details" JSONB NOT NULL,
 "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updated_at" TIMESTAMPTZ(3) NOT NULL
);
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_tool_id_fkey" FOREIGN KEY ("tool_id") REFERENCES "tools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_tool_id_fkey" FOREIGN KEY ("tool_id") REFERENCES "tools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_reverses_id_fkey" FOREIGN KEY ("reverses_id") REFERENCES "inventory_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_policies" ADD CONSTRAINT "inventory_policies_tool_id_fkey" FOREIGN KEY ("tool_id") REFERENCES "tools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_items" ADD CONSTRAINT "supplier_items_tool_id_fkey" FOREIGN KEY ("tool_id") REFERENCES "tools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_items" ADD CONSTRAINT "supplier_items_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_tool_id_fkey" FOREIGN KEY ("tool_id") REFERENCES "tools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reorder_candidates" ADD CONSTRAINT "reorder_candidates_tool_id_fkey" FOREIGN KEY ("tool_id") REFERENCES "tools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "stock_balances_tool_id_location_id_key" ON "stock_balances" ("tool_id", "location_id");
CREATE UNIQUE INDEX "supplier_items_tool_id_supplier_id_key" ON "supplier_items" ("tool_id", "supplier_id");
CREATE INDEX "inventory_transactions_tool_id_created_at_idx" ON "inventory_transactions" ("tool_id", "created_at");
CREATE INDEX "inventory_transactions_actor_user_id_created_at_idx" ON "inventory_transactions" ("actor_user_id", "created_at");
CREATE INDEX "inventory_transactions_machine_id_created_at_idx" ON "inventory_transactions" ("machine_id", "created_at");
CREATE INDEX "purchase_orders_status_created_at_idx" ON "purchase_orders" ("status", "created_at");
CREATE INDEX "purchase_order_items_order_id_idx" ON "purchase_order_items" ("order_id");
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs" ("actor_user_id", "created_at");
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_valid" CHECK (on_hand >= 0 AND reserved >= 0 AND reserved <= on_hand);
ALTER TABLE "inventory_policies" ADD CONSTRAINT "inventory_policies_valid" CHECK (safety_stock >= 0 AND safety_stock <= reorder_point AND reorder_point <= target_stock);
ALTER TABLE "supplier_items" ADD CONSTRAINT "supplier_items_valid" CHECK (unit_price >= 0 AND order_multiple > 0 AND lead_time_days >= 0);
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_valid" CHECK (ordered_quantity > 0 AND received_quantity >= 0 AND received_quantity <= ordered_quantity AND unit_price >= 0 AND order_multiple > 0 AND lead_time_days >= 0);
ALTER TABLE "reorder_candidates" ADD CONSTRAINT "reorder_candidates_valid" CHECK (quantity > 0);
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_valid" CHECK (quantity <> 0 AND (type <> 'ISSUE' OR (quantity < 0 AND machine_id IS NOT NULL)) AND (type <> 'RECEIVE' OR quantity > 0) AND (type NOT IN ('ADJUSTMENT','REVERSAL') OR length(trim(reason)) > 0 AND reason IS NOT NULL) AND (type <> 'REVERSAL' OR reverses_id IS NOT NULL));
CREATE UNIQUE INDEX "reorder_candidates_one_open" ON reorder_candidates(tool_id) WHERE status = 'OPEN';
CREATE UNIQUE INDEX "supplier_items_one_preferred" ON supplier_items(tool_id) WHERE preferred;
CREATE FUNCTION prevent_history_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'History is append-only'; END $$;
CREATE TRIGGER inventory_history_immutable BEFORE UPDATE OR DELETE ON inventory_transactions FOR EACH ROW EXECUTE FUNCTION prevent_history_change();
CREATE TRIGGER audit_history_immutable BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION prevent_history_change();
