-- ============================================================
-- UNIQUE 제약 조건 롤백 + 채널 기본값 설정
-- 현장에서는 동일 수량 데이터가 여러 번 발생할 수 있으므로
-- DB 레벨에서 강제로 막지 않음. 중복은 코드(병합/덮어쓰기)로 처리.
-- ============================================================
-- Supabase SQL Editor에서 실행하세요.
-- ============================================================

-- 1. 입고 unique 제약 (다양한 이름 대응)
DROP INDEX IF EXISTS idx_inbound_upsert;
DROP INDEX IF EXISTS unique_inbound_record;
DROP INDEX IF EXISTS inventory_inbound_product_code_inbound_date_sales_channel_key;

-- 2. 출고 unique 제약
DROP INDEX IF EXISTS idx_outbound_upsert;
DROP INDEX IF EXISTS unique_outbound_record;
DROP INDEX IF EXISTS inventory_outbound_product_code_outbound_date_sales_channel_key;

-- 3. 재고 스냅샷 unique 제약 (product_code PK는 유지 - 품목별 1행)
DROP INDEX IF EXISTS unique_current_stock;
DROP INDEX IF EXISTS idx_stock_snapshot_upsert;

-- 4. 채널 기본값: 비어있거나 NULL인 과거 데이터 → 'general' 강제 할당
UPDATE inventory_inbound
SET sales_channel = 'general'::sales_channel
WHERE sales_channel IS NULL;

UPDATE inventory_outbound
SET sales_channel = 'general'::sales_channel
WHERE sales_channel IS NULL;

-- 5. 컬럼 기본값 설정 (신규 INSERT 시)
ALTER TABLE inventory_inbound
  ALTER COLUMN sales_channel SET DEFAULT 'general'::sales_channel;

ALTER TABLE inventory_outbound
  ALTER COLUMN sales_channel SET DEFAULT 'general'::sales_channel;

-- 완료
SELECT 'UNIQUE 제약 조건 롤백 및 채널 기본값 설정 완료' AS status;
