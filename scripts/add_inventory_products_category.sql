-- ============================================================
-- inventory_products에 category 컬럼 추가
-- product_code(바코드) ↔ category(품목구분) 매칭용
-- Supabase SQL Editor에서 실행하세요.
-- ============================================================

ALTER TABLE inventory_products ADD COLUMN IF NOT EXISTS category TEXT DEFAULT '';

SELECT 'inventory_products.category 컬럼 추가 완료' AS status;
