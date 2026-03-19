-- ============================================================
-- 출고 병합 로직 제거: 1 row = 1 출고 트랜잭션 유지
-- (product_code, outbound_date, dest_warehouse) unique 제약 제거
-- Supabase SQL Editor에서 실행
-- ============================================================
-- 
-- 배경: 기존에는 동일 키로 수량을 합산하여 1건으로 적재했으나,
-- 출고는 거래 단위로 유지해야 함. 집계는 KPI/그래프에서 별도 처리.
--
-- 기존 병합된 데이터: 2798건 (2965건 중 167건 병합됨)
-- 수정 후: 2965건 (원본 그대로 1 row = 1 트랜잭션)
-- 
-- 기존 데이터 폐기: 당월 outbound_date 기준으로 삭제 후 재업로드 권장
-- ============================================================

-- 1. unique index 제거 (동일 품목·날짜·창고에 여러 행 허용)
DROP INDEX IF EXISTS idx_outbound_upsert;
DROP INDEX IF EXISTS inventory_outbound_product_code_outbound_date_sales_channel_key;
DROP INDEX IF EXISTS inventory_outbound_product_code_outbound_date_dest_warehouse_key;

-- 2. PK는 id (uuid) 유지 - 각 행 고유
-- 3. 집계용 인덱스만 유지 (조회 성능)
CREATE INDEX IF NOT EXISTS idx_inv_outbound_date ON inventory_outbound(outbound_date DESC);
CREATE INDEX IF NOT EXISTS idx_inv_outbound_product ON inventory_outbound(product_code);
CREATE INDEX IF NOT EXISTS idx_inv_outbound_channel ON inventory_outbound(sales_channel);

SELECT '출고 unique 제약 제거 완료. 1 row = 1 트랜잭션.' AS status;
