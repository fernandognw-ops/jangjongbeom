-- ============================================================
-- 생활용품 → 전체로 이동
-- 재배정이 안 되는 품목들을 '전체'로 옮겨서 카테고리 재할당 가능하게 함
-- Supabase SQL Editor에서 실행하세요.
-- ============================================================

-- 1. inventory_products
UPDATE inventory_products
SET category = '전체', group_name = '전체'
WHERE category = '생활용품' OR group_name = '생활용품';

-- 2. inventory_stock_snapshot
UPDATE inventory_stock_snapshot
SET category = '전체'
WHERE category = '생활용품';

-- 3. inventory_inbound
UPDATE inventory_inbound
SET category = '전체'
WHERE category = '생활용품';

-- 4. inventory_outbound
UPDATE inventory_outbound
SET category = '전체'
WHERE category = '생활용품';

SELECT '생활용품 → 전체 이동 완료' AS status;
