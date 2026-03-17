-- ============================================================
-- inventory_stock_snapshot의 product_name, category가 NULL인 행 보완
-- inventory_products에서 product_name, category(group_name) 가져와 채움
-- Supabase SQL Editor에서 실행
-- ============================================================

-- product_name 보완
UPDATE inventory_stock_snapshot s
SET product_name = COALESCE(NULLIF(TRIM(p.product_name), ''), p.product_code)
FROM inventory_products p
WHERE s.product_code = p.product_code
  AND (s.product_name IS NULL OR TRIM(s.product_name) = '');

-- category 보완 (group_name 또는 category 우선)
UPDATE inventory_stock_snapshot s
SET category = COALESCE(
  NULLIF(TRIM(p.category), ''),
  NULLIF(TRIM(p.group_name), ''),
  s.category,
  '기타'
)
FROM inventory_products p
WHERE s.product_code = p.product_code
  AND (s.category IS NULL OR TRIM(s.category) = '');

SELECT 'inventory_stock_snapshot product_name, category 보완 완료' AS status;
