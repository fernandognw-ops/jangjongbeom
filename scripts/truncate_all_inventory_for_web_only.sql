-- ============================================================
-- 웹 업로드 단일 반영 구조 전환용 DB 전체 초기화
-- inventory_*, inventory_sync 모두 비움
-- ============================================================
-- Supabase SQL Editor에서 실행하세요.
-- FK 순서: 자식 테이블 먼저 → 부모

-- 1) inventory_sync (독립 테이블, FK 없음)
TRUNCATE TABLE inventory_sync;

-- 2) inventory_inbound, inventory_outbound (inventory_products 참조 가능)
TRUNCATE TABLE inventory_inbound CASCADE;
TRUNCATE TABLE inventory_outbound CASCADE;

-- 3) inventory_stock_snapshot (inventory_products 참조 없음, 독립)
TRUNCATE TABLE inventory_stock_snapshot CASCADE;

-- 4) inventory_products (부모)
TRUNCATE TABLE inventory_products CASCADE;

-- 검증: 각 테이블 row count = 0
SELECT 'inventory_sync' AS tbl, COUNT(*) AS cnt FROM inventory_sync
UNION ALL SELECT 'inventory_inbound', COUNT(*) FROM inventory_inbound
UNION ALL SELECT 'inventory_outbound', COUNT(*) FROM inventory_outbound
UNION ALL SELECT 'inventory_stock_snapshot', COUNT(*) FROM inventory_stock_snapshot
UNION ALL SELECT 'inventory_products', COUNT(*) FROM inventory_products;
