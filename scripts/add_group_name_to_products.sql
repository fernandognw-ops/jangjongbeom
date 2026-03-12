-- inventory_products에 group_name 컬럼 추가 (없을 때만)
-- Supabase SQL Editor에서 실행하세요.
ALTER TABLE inventory_products ADD COLUMN IF NOT EXISTS group_name TEXT DEFAULT '기타';

SELECT 'inventory_products.group_name 컬럼 추가 완료' AS status;
