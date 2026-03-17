-- ============================================================
-- rawdata(품목) 기준으로 inventory_stock_snapshot.category 동기화
-- inventory_products.category = rawdata 품목 컬럼 (대시보드 카테고리 기준)
-- Supabase SQL Editor에서 실행
-- ============================================================

-- inventory_products(rawdata 품목) → snapshot.category 덮어쓰기 (카테고리 기준 정정)
UPDATE inventory_stock_snapshot s
SET category = COALESCE(
  NULLIF(TRIM(p.category), ''),
  NULLIF(TRIM(p.group_name), ''),
  s.category,
  '기타'
)
FROM inventory_products p
WHERE s.product_code = p.product_code
  AND (NULLIF(TRIM(COALESCE(p.category, p.group_name, '')), '') IS NOT NULL);

SELECT 'inventory_stock_snapshot category ← rawdata(품목) 동기화 완료' AS status;
