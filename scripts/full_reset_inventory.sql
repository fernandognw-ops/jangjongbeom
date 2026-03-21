-- ============================================================
-- 완전 초기화: inventory_* 전체 데이터 삭제
-- 웹 업로드 단일 반영 전, 기존 데이터 제거용
-- ============================================================
-- Supabase SQL Editor에서 실행하세요.
-- 백업 필요 시: 아래 1단계 백업 쿼리를 먼저 실행 후 2~4단계 진행

-- ========== 1단계: 삭제 전 row count (백업 여부 확인용) ==========
SELECT '1. 삭제 전' AS phase, 'inventory_sync' AS tbl, COUNT(*) AS cnt FROM inventory_sync
UNION ALL SELECT '1. 삭제 전', 'inventory_inbound', COUNT(*) FROM inventory_inbound
UNION ALL SELECT '1. 삭제 전', 'inventory_outbound', COUNT(*) FROM inventory_outbound
UNION ALL SELECT '1. 삭제 전', 'inventory_stock_snapshot', COUNT(*) FROM inventory_stock_snapshot
UNION ALL SELECT '1. 삭제 전', 'inventory_products', COUNT(*) FROM inventory_products;

-- [선택] 백업 필요 시 아래 실행 (테이블별 백업)
-- CREATE TABLE inventory_products_backup_reset AS SELECT * FROM inventory_products;
-- CREATE TABLE inventory_inbound_backup_reset AS SELECT * FROM inventory_inbound;
-- CREATE TABLE inventory_outbound_backup_reset AS SELECT * FROM inventory_outbound;
-- CREATE TABLE inventory_stock_snapshot_backup_reset AS SELECT * FROM inventory_stock_snapshot;
-- CREATE TABLE inventory_sync_backup_reset AS SELECT * FROM inventory_sync;

-- ========== 2단계: TRUNCATE (FK 순서 고려) ==========
TRUNCATE TABLE inventory_sync;
TRUNCATE TABLE inventory_inbound CASCADE;
TRUNCATE TABLE inventory_outbound CASCADE;
TRUNCATE TABLE inventory_stock_snapshot CASCADE;
TRUNCATE TABLE inventory_products CASCADE;

-- ========== 3단계: 삭제 후 row count = 0 확인 ==========
SELECT '2. 삭제 후' AS phase, 'inventory_sync' AS tbl, COUNT(*) AS cnt FROM inventory_sync
UNION ALL SELECT '2. 삭제 후', 'inventory_inbound', COUNT(*) FROM inventory_inbound
UNION ALL SELECT '2. 삭제 후', 'inventory_outbound', COUNT(*) FROM inventory_outbound
UNION ALL SELECT '2. 삭제 후', 'inventory_stock_snapshot', COUNT(*) FROM inventory_stock_snapshot
UNION ALL SELECT '2. 삭제 후', 'inventory_products', COUNT(*) FROM inventory_products;
