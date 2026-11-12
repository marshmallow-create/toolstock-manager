CREATE TABLE tool_orders (
 id UUID PRIMARY KEY,
 tool_id UUID NOT NULL REFERENCES tools(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 request_key TEXT NOT NULL UNIQUE,
 order_quantity INTEGER NOT NULL CHECK (order_quantity > 0),
 order_unit TEXT NOT NULL,
 units_per_order INTEGER NOT NULL CHECK (units_per_order > 0),
 stock_quantity INTEGER NOT NULL CHECK (stock_quantity > 0),
 received_quantity INTEGER NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
 cancelled_quantity INTEGER NOT NULL DEFAULT 0 CHECK (cancelled_quantity >= 0),
 purchase_unit_price DECIMAL(14,2),
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT tool_orders_remaining_valid CHECK (received_quantity::bigint + cancelled_quantity <= stock_quantity),
 CONSTRAINT tool_orders_conversion_valid CHECK (order_quantity::bigint * units_per_order = stock_quantity)
);
CREATE INDEX tool_orders_tool_id_created_at_idx ON tool_orders(tool_id,created_at);
ALTER TABLE inventory_transactions ADD COLUMN tool_order_id UUID REFERENCES tool_orders(id) ON DELETE RESTRICT ON UPDATE CASCADE, ADD COLUMN receipt_units_per_order INTEGER;
