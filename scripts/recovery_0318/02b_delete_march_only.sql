-- ============================================================
-- 2b단계 (선택): 3월 inbound/outbound 전체 삭제
-- (재고 스냅샷 3월 포함 전체 비우기는 scripts/delete_inventory_month_2026_03.sql 권장)
-- sync가 "당월만 삭제 후 upsert"하므로, 3월 데이터가 잘못되었다면
-- created_at 기준이 아닌 inbound_date/outbound_date 기준으로 삭제해야 함.
-- 현재 웹 커밋은 inventory_stock_snapshot도 source_row_key upsert이므로,
-- 3월 스냅샷까지 지우려면 아래 snapshot DELETE를 함께 실행하세요.
-- ============================================================
-- ⚠️ 01_backup 실행 후, 02 대신 이 스크립트를 사용할 수 있음.
--    또는 02 실행 후 3월 데이터가 여전히 잘못되어 있으면 이 스크립트 실행.
-- ============================================================

-- 삭제 대상 확인
SELECT 'inbound_march' AS tbl, COUNT(*) AS cnt FROM inventory_inbound
WHERE inbound_date >= '2026-03-01' AND inbound_date < '2026-04-01'
UNION ALL
SELECT 'outbound_march', COUNT(*) FROM inventory_outbound
WHERE outbound_date >= '2026-03-01' AND outbound_date < '2026-04-01'
UNION ALL
SELECT 'snapshot_march', COUNT(*) FROM inventory_stock_snapshot
WHERE snapshot_date >= '2026-03-01' AND snapshot_date < '2026-04-01';

-- 3월 inbound 삭제
DELETE FROM inventory_inbound
WHERE inbound_date >= '2026-03-01' AND inbound_date < '2026-04-01';

-- 3월 outbound 삭제
DELETE FROM inventory_outbound
WHERE outbound_date >= '2026-03-01' AND outbound_date < '2026-04-01';

-- 3월 재고 스냅샷 삭제 (미실행 시 3월 스냅샷 행이 DB에 남을 수 있음)
DELETE FROM inventory_stock_snapshot
WHERE snapshot_date >= '2026-03-01' AND snapshot_date < '2026-04-01';

SELECT '3월 inbound/outbound/stock_snapshot 삭제 완료.' AS status;
