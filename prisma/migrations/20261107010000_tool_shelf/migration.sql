ALTER TABLE tools ADD COLUMN shelf_code TEXT NOT NULL DEFAULT '';

-- Preserve all existing shelf codes without changing balances or historical references.
UPDATE tools AS tool SET shelf_code = shelves.codes
FROM (
 SELECT stock.tool_id, string_agg(DISTINCT location.location_code, ' / ' ORDER BY location.location_code) AS codes
 FROM stock_balances AS stock JOIN locations AS location ON location.id = stock.location_id
 GROUP BY stock.tool_id
) AS shelves WHERE tool.id = shelves.tool_id;
