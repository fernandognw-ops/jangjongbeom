-- ============================================================
-- 특정 품목코드의 품목구분(category) 수동 수정
-- 예: 소프트핏 대형(8809912470572) → 마스크
-- ============================================================
-- 사용법: 아래 UPDATE의 product_code, category 값을 수정 후 실행

-- inventory_stock_snapshot (재고 시트)
UPDATE inventory_stock_snapshot
SET category = '마스크'
WHERE product_code = '8809912470572';

-- inventory_products (rawdata)
UPDATE inventory_products
SET group_name = '마스크'
WHERE product_code = '8809912470572';

SELECT '품목구분 수정 완료: 8809912470572 → 마스크' AS status;
