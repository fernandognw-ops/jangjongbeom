-- ============================================================
-- 2단계: 2026-03-18 07:00 KST 이후 잘못 적재된 데이터 삭제
-- ⚠️ 반드시 01_backup_before_delete.sql 실행 후 진행
-- Supabase SQL Editor에서 실행하세요.
-- ============================================================
-- 삭제 기준:
--   inbound:  created_at >= 2026-03-18 07:00 KST
--   outbound: created_at >= 2026-03-18 07:00 KST
--   stock:    updated_at >= 2026-03-18 07:00 KST
--
-- sync 로직: inbound/outbound는 당월만 삭제 후 upsert.
--            따라서 3월 데이터가 잘못되었다면 당월 전체 삭제가 필요할 수 있음.
--            아래는 created_at/updated_at 기준으로만 삭제 (보수적).
--            당월 전체 삭제가 필요하면 02b_delete_march_only.sql 사용.
-- ============================================================

-- 삭제 전 최종 row count 확인
SELECT '삭제 대상' AS phase, 'inbound' AS tbl, COUNT(*) AS cnt
FROM inventory_inbound WHERE created_at >= '2026-03-18 07:00:00+09'
UNION ALL SELECT '삭제 대상', 'outbound', COUNT(*) FROM inventory_outbound WHERE created_at >= '2026-03-18 07:00:00+09'
UNION ALL SELECT '삭제 대상', 'stock', COUNT(*) FROM inventory_stock_snapshot WHERE updated_at >= '2026-03-18 07:00:00+09';

-- 1. inbound: 07:00 이후 생성된 행 삭제
DELETE FROM inventory_inbound
WHERE created_at >= '2026-03-18 07:00:00+09';

-- 2. outbound: 07:00 이후 생성된 행 삭제
DELETE FROM inventory_outbound
WHERE created_at >= '2026-03-18 07:00:00+09';

-- 3. stock: 07:00 이후 갱신된 행 삭제
--    (sync가 전체 삭제 후 insert하므로, 잘못된 sync 후엔 전부 해당될 수 있음)
DELETE FROM inventory_stock_snapshot
WHERE updated_at >= '2026-03-18 07:00:00+09';

-- 삭제 후 확인
SELECT 'inbound' AS tbl, COUNT(*) AS remaining FROM inventory_inbound
UNION ALL SELECT 'outbound', COUNT(*) FROM inventory_outbound
UNION ALL SELECT 'stock', COUNT(*) FROM inventory_stock_snapshot;

SELECT '삭제 완료. 03_reload_excel 단계로 진행하세요.' AS status;
