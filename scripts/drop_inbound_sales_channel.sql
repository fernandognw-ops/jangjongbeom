-- ============================================================
-- inventory_inbound에서 sales_channel 컬럼 제거
-- 입고 데이터에는 채널 정보를 사용하지 않음
-- ============================================================
-- Supabase SQL Editor에서 실행하세요.
-- ============================================================

-- 1. 기존 unique 제약 제거 (sales_channel 포함)
DROP INDEX IF EXISTS idx_inbound_upsert;
DROP INDEX IF EXISTS inventory_inbound_product_code_inbound_date_sales_channel_key;

-- 2. 채널 인덱스 제거
DROP INDEX IF EXISTS idx_inv_inbound_channel;

-- 3. sales_channel 컬럼 제거
ALTER TABLE inventory_inbound DROP COLUMN IF EXISTS sales_channel;

-- 4. upsert용 unique 제약 (product_code + inbound_date만)
CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_upsert
  ON inventory_inbound (product_code, inbound_date);

-- 완료
SELECT 'inventory_inbound sales_channel 제거 완료' AS status;
