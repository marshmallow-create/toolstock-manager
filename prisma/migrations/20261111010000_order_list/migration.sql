-- Only future qualifying issues enqueue tools. Existing issues are not backfilled.
CREATE TABLE "order_list_entries" (
    "id" UUID NOT NULL,
    "tool_id" UUID NOT NULL,
    "trigger_transaction_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "order_list_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "order_list_entries_tool_id_key" ON "order_list_entries"("tool_id");
CREATE INDEX "order_list_entries_trigger_transaction_id_idx" ON "order_list_entries"("trigger_transaction_id");

ALTER TABLE "order_list_entries" ADD CONSTRAINT "order_list_entries_tool_id_fkey"
    FOREIGN KEY ("tool_id") REFERENCES "tools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_list_entries" ADD CONSTRAINT "order_list_entries_trigger_transaction_id_fkey"
    FOREIGN KEY ("trigger_transaction_id") REFERENCES "inventory_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
