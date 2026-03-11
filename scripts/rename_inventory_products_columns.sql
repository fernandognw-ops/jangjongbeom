-- ============================================================
-- inventory_products 컬럼명 통일 (데이터 매칭용)
-- 재고 수량/금액 매칭: inventory_stock_snapshot.product_code ↔ inventory_products
-- Supabase SQL Editor에서 실행하세요.
-- ============================================================

-- 사용자 지시: name → product_code
ALTER TABLE inventory_products RENAME COLUMN name TO product_code;

-- 완료
SELECT 'inventory_products.name → product_code 변경 완료' AS status;
