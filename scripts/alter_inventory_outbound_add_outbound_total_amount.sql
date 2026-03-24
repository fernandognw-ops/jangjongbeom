ALTER TABLE IF EXISTS inventory_outbound
  ADD COLUMN IF NOT EXISTS outbound_total_amount NUMERIC(14,2) DEFAULT 0;

UPDATE inventory_outbound
SET outbound_total_amount = COALESCE(NULLIF(outbound_total_amount, 0), COALESCE(total_price, 0))
WHERE COALESCE(outbound_total_amount, 0) = 0;
