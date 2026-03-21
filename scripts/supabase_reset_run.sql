-- ============================================================
-- Supabase SQL Editor에서 "Run" 한 번으로 실행
-- 완전 초기화: inventory_* 전체 삭제
-- ============================================================

-- [1] 삭제 전 row count
SELECT '삭제 전' AS phase, 'inventory_sync' AS tbl, COUNT(*) AS cnt FROM inventory_sync
UNION ALL SELECT '삭제 전', 'inventory_inbound', COUNT(*) FROM inventory_inbound
UNION ALL SELECT '삭제 전', 'inventory_outbound', COUNT(*) FROM inventory_outbound
UNION ALL SELECT '삭제 전', 'inventory_stock_snapshot', COUNT(*) FROM inventory_stock_snapshot
UNION ALL SELECT '삭제 전', 'inventory_products', COUNT(*) FROM inventory_products;

-- [2] TRUNCATE
TRUNCATE TABLE inventory_sync;
TRUNCATE TABLE inventory_inbound CASCADE;
TRUNCATE TABLE inventory_outbound CASCADE;
TRUNCATE TABLE inventory_stock_snapshot CASCADE;
TRUNCATE TABLE inventory_products CASCADE;

-- [3] 삭제 후 row count (모두 0이어야 함)
SELECT '삭제 후' AS phase, 'inventory_sync' AS tbl, COUNT(*) AS cnt FROM inventory_sync
UNION ALL SELECT '삭제 후', 'inventory_inbound', COUNT(*) FROM inventory_inbound
UNION ALL SELECT '삭제 후', 'inventory_outbound', COUNT(*) FROM inventory_outbound
UNION ALL SELECT '삭제 후', 'inventory_stock_snapshot', COUNT(*) FROM inventory_stock_snapshot
UNION ALL SELECT '삭제 후', 'inventory_products', COUNT(*) FROM inventory_products;
