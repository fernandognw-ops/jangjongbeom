-- ============================================================
-- inventory_stock_snapshot: (product_code, dest_warehouse) 복합 PK
-- dest_warehouse = 창고명 (동일 개념)
-- 쿠팡/일반 채널별 재고 분리 저장
-- Supabase SQL Editor에서 실행하세요.
-- ============================================================

-- dest_warehouse가 NULL/빈값이면 '제이에스'로 (API 일반 재고 매칭)
UPDATE inventory_stock_snapshot SET dest_warehouse = '제이에스' WHERE dest_warehouse IS NULL OR dest_warehouse = '';

-- 기존 PK 제거 후 복합 PK 추가
ALTER TABLE inventory_stock_snapshot DROP CONSTRAINT IF EXISTS inventory_stock_snapshot_pkey;
ALTER TABLE inventory_stock_snapshot ADD CONSTRAINT inventory_stock_snapshot_pkey PRIMARY KEY (product_code, dest_warehouse);

SELECT 'inventory_stock_snapshot 복합 PK 적용 완료' AS status;
