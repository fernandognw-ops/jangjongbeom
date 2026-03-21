-- ============================================================
-- 입고 병합 로직 제거: 1 row = 1 입고 행 유지
-- inventory_inbound의 모든 unique constraint/index 제거
-- Supabase SQL Editor에서 실행
-- ============================================================
--
-- 배경: 기존에는 동일 키로 수량을 합산하여 1건으로 적재했으나,
-- 입고도 출고와 동일하게 원본 행 보존. 병합/집계는 조회 시점에 수행.
--
-- 기대: inbound 172건 그대로 저장 (동일 품목·날짜·창고 여러 행 허용)
--
-- ============================================================

-- 1. unique constraint 제거 (ALTER TABLE DROP CONSTRAINT)
ALTER TABLE inventory_inbound DROP CONSTRAINT IF EXISTS inventory_inbound_unique_pcode_date;
ALTER TABLE inventory_inbound DROP CONSTRAINT IF EXISTS inventory_inbound_product_code_inbound_date_key;
ALTER TABLE inventory_inbound DROP CONSTRAINT IF EXISTS inventory_inbound_product_code_inbound_date_sales_channel_key;

-- 2. unique index 제거 (CREATE UNIQUE INDEX로 생성된 것)
DROP INDEX IF EXISTS idx_inbound_upsert;
DROP INDEX IF EXISTS unique_inbound_record;

-- 3. PK는 id (uuid) 유지 - 각 행 고유
-- 4. 조회용 인덱스만 유지
CREATE INDEX IF NOT EXISTS idx_inv_inbound_date ON inventory_inbound(inbound_date DESC);
CREATE INDEX IF NOT EXISTS idx_inv_inbound_product ON inventory_inbound(product_code);
CREATE INDEX IF NOT EXISTS idx_inv_inbound_warehouse ON inventory_inbound(dest_warehouse);

SELECT '입고 unique 제약 제거 완료. 1 row = 1 입고 행.' AS status;
