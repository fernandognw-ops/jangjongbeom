-- ============================================================
-- inventory_stock_snapshot: dest_warehouse(창고명) 빈값 채우기
-- 기존 데이터에 dest_warehouse가 비어 있으면 '제이에스'(일반)로 설정
-- Supabase SQL Editor에서 실행하세요.
-- ============================================================

UPDATE inventory_stock_snapshot
SET dest_warehouse = '제이에스'
WHERE dest_warehouse IS NULL
   OR TRIM(COALESCE(dest_warehouse, '')) = '';

SELECT 'dest_warehouse 채우기 완료' AS status;
