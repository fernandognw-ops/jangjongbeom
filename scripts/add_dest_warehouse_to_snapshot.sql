-- ============================================================
-- inventory_stock_snapshot에 dest_warehouse(창고명) 컬럼 추가
-- dest_warehouse = 창고명 (동일 개념)
-- Supabase SQL Editor에서 실행하세요.
-- ============================================================

ALTER TABLE inventory_stock_snapshot ADD COLUMN IF NOT EXISTS dest_warehouse TEXT DEFAULT '';  -- 창고명

SELECT 'dest_warehouse 컬럼 추가 완료' AS status;
