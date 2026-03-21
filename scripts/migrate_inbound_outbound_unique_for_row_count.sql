-- ============================================================
-- 입고/출고 검증값=적재값 맞추기: unique 제약 변경
-- 검증 172건 → DB 172건, 검증 2965건 → DB 2965건
-- Supabase SQL Editor에서 실행
-- ============================================================

-- 1. 입고: (product_code, inbound_date) → (product_code, inbound_date, dest_warehouse)
DROP INDEX IF EXISTS idx_inbound_upsert;
DROP INDEX IF EXISTS inventory_inbound_product_code_inbound_date_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_upsert
  ON inventory_inbound (product_code, inbound_date, dest_warehouse);

-- 2. 출고: (product_code, outbound_date, sales_channel) → (product_code, outbound_date, dest_warehouse)
DROP INDEX IF EXISTS idx_outbound_upsert;
DROP INDEX IF EXISTS inventory_outbound_product_code_outbound_date_sales_channel_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_upsert
  ON inventory_outbound (product_code, outbound_date, dest_warehouse);

SELECT '입고/출고 unique 제약 변경 완료' AS status;
