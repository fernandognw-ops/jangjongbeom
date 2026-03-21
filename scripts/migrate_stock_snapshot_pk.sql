-- ============================================================
-- inventory_stock_snapshot 복합 PK 마이그레이션
-- 날짜별·센터별 확정 재고 스냅샷 저장을 위해
-- product_code 단일 PK → (product_code, dest_warehouse, snapshot_date) 복합 PK로 변경
-- Supabase SQL Editor에서 실행하세요.
-- ============================================================

-- 기존 PK 제거
ALTER TABLE inventory_stock_snapshot DROP CONSTRAINT IF EXISTS inventory_stock_snapshot_pkey;

-- NULL/빈값 정규화 (기존 데이터 호환)
UPDATE inventory_stock_snapshot SET dest_warehouse = COALESCE(NULLIF(TRIM(dest_warehouse), ''), '일반') WHERE dest_warehouse IS NULL OR TRIM(dest_warehouse) = '';

-- 복합 PK 추가
ALTER TABLE inventory_stock_snapshot ADD PRIMARY KEY (product_code, dest_warehouse, snapshot_date);

SELECT 'inventory_stock_snapshot PK 마이그레이션 완료' AS status;
