-- ============================================================
-- 출고 병합 로직 제거: 1 row = 1 출고 트랜잭션 유지
-- inventory_outbound의 모든 unique constraint/index 제거
-- Supabase SQL Editor에서 실행
-- ============================================================
--
-- 배경: 기존에는 동일 키로 수량을 합산하여 1건으로 적재했으나,
-- 출고는 거래 단위로 유지해야 함. 병합/집계는 조회 시점에만 수행.
--
-- 기대: outbound 2965건 원본 그대로 저장
--
-- ============================================================

-- 1. unique constraint 제거 (ALTER TABLE DROP CONSTRAINT)
-- product_code + outbound_date, product_code + outbound_date + sales_channel, dest_warehouse 기준
ALTER TABLE inventory_outbound DROP CONSTRAINT IF EXISTS idx_outbound_upsert;
ALTER TABLE inventory_outbound DROP CONSTRAINT IF EXISTS inventory_outbound_product_code_outbound_date_key;
ALTER TABLE inventory_outbound DROP CONSTRAINT IF EXISTS inventory_outbound_product_code_outbound_date_sales_channel_key;
ALTER TABLE inventory_outbound DROP CONSTRAINT IF EXISTS inventory_outbound_product_code_outbound_date_dest_warehouse_key;

-- 2. unique index 제거 (CREATE UNIQUE INDEX로 생성된 것)
DROP INDEX IF EXISTS idx_outbound_upsert;
DROP INDEX IF EXISTS inventory_outbound_product_code_outbound_date_sales_channel_key;
DROP INDEX IF EXISTS inventory_outbound_product_code_outbound_date_dest_warehouse_key;
DROP INDEX IF EXISTS unique_outbound_record;

-- 3. PK는 id (uuid) 유지 - 각 행 고유
-- 4. 조회용 인덱스만 유지
CREATE INDEX IF NOT EXISTS idx_inv_outbound_date ON inventory_outbound(outbound_date DESC);
CREATE INDEX IF NOT EXISTS idx_inv_outbound_product ON inventory_outbound(product_code);
CREATE INDEX IF NOT EXISTS idx_inv_outbound_channel ON inventory_outbound(sales_channel);
CREATE INDEX IF NOT EXISTS idx_inv_outbound_warehouse ON inventory_outbound(dest_warehouse);

SELECT '출고 unique 제약 제거 완료. 1 row = 1 트랜잭션.' AS status;
