-- ============================================================
-- inventory_products.group_name 컬럼 복구
-- Supabase SQL Editor에서 실행하세요.
-- ============================================================

-- 1. group_name 컬럼 추가 (삭제된 경우)
ALTER TABLE inventory_products ADD COLUMN IF NOT EXISTS group_name TEXT DEFAULT '기타';

-- 2. category가 있으면 group_name에 반영 (품목구분 동기화)
UPDATE inventory_products
SET group_name = category
WHERE category IS NOT NULL AND TRIM(category) != ''
  AND (group_name IS NULL OR TRIM(group_name) = '' OR TRIM(group_name) = '기타');

SELECT 'inventory_products.group_name 복구 완료' AS status;
