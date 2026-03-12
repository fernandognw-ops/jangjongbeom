-- ============================================================
-- 품목코드(product_code) → 품목구분(category) 매칭
-- 1. inventory_stock_snapshot.category ← inventory_products.group_name (snapshot 비어있을 때)
-- 2. inventory_products.group_name ← inventory_stock_snapshot.category (group_name이 기타/비어있을 때)
-- ============================================================

-- 1. snapshot.category 보완
UPDATE inventory_stock_snapshot s
SET category = COALESCE(NULLIF(TRIM(p.group_name), ''), s.category, '생활용품')
FROM inventory_products p
WHERE s.product_code = p.product_code
  AND (s.category IS NULL OR TRIM(s.category) = '');

-- 2. inventory_products.group_name 보완 (기타/비어있을 때 snapshot에서)
UPDATE inventory_products p
SET group_name = COALESCE(NULLIF(TRIM(s.cat), ''), p.group_name, '생활용품')
FROM (
  SELECT product_code, category AS cat,
    ROW_NUMBER() OVER (PARTITION BY product_code ORDER BY snapshot_date DESC NULLS LAST) AS rn
  FROM inventory_stock_snapshot
  WHERE category IS NOT NULL AND TRIM(category) != ''
) s
WHERE p.product_code = s.product_code AND s.rn = 1
  AND (TRIM(COALESCE(p.group_name, '')) = '' OR TRIM(p.group_name) = '기타');

SELECT '품목코드→품목구분 매칭 보완 완료' AS status;
