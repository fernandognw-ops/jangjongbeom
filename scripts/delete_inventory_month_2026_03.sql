-- ============================================================
-- 2026년 3월 입고·출고·재고 스냅샷 일괄 삭제 (재업로드 전 비우기)
-- Supabase SQL Editor에서 한 번에 실행하세요.
--
-- 대상: 거래/스냅샷 일자가 2026-03-01 ~ 2026-03-31 인 행
-- 제외: inventory_products (rawdata 마스터) — 재업로드 시 upsert로 갱신됨
--       inventory_current_products — 재업로드 시 품목 코드로 다시 채워짐
--
-- 원칙(당월 최신 1건): 웹 커밋은 source_row_key upsert라, 키가 달라진 중복 행은
--   "월 단위 삭제 후 재업로드"로만 정리하는 것이 안전합니다.
-- ============================================================

-- ---------- 삭제 전 백업 (트랜잭션 밖: 삭제 실패·롤백 시에도 백업 유지) ----------
DROP TABLE IF EXISTS inventory_inbound_backup_purge_202603;
CREATE TABLE inventory_inbound_backup_purge_202603 AS
SELECT * FROM inventory_inbound
WHERE inbound_date >= '2026-03-01' AND inbound_date < '2026-04-01';

DROP TABLE IF EXISTS inventory_outbound_backup_purge_202603;
CREATE TABLE inventory_outbound_backup_purge_202603 AS
SELECT * FROM inventory_outbound
WHERE outbound_date >= '2026-03-01' AND outbound_date < '2026-04-01';

DROP TABLE IF EXISTS inventory_stock_snapshot_backup_purge_202603;
CREATE TABLE inventory_stock_snapshot_backup_purge_202603 AS
SELECT * FROM inventory_stock_snapshot
WHERE snapshot_date >= '2026-03-01' AND snapshot_date < '2026-04-01';

BEGIN;

-- ---------- 삭제 전 건수 ----------
SELECT 'before_delete' AS phase, 'inbound_march' AS tbl, COUNT(*) AS cnt FROM inventory_inbound
WHERE inbound_date >= '2026-03-01' AND inbound_date < '2026-04-01'
UNION ALL
SELECT 'before_delete', 'outbound_march', COUNT(*) FROM inventory_outbound
WHERE outbound_date >= '2026-03-01' AND outbound_date < '2026-04-01'
UNION ALL
SELECT 'before_delete', 'snapshot_march', COUNT(*) FROM inventory_stock_snapshot
WHERE snapshot_date >= '2026-03-01' AND snapshot_date < '2026-04-01';

-- ---------- 삭제 ----------
DELETE FROM inventory_inbound
WHERE inbound_date >= '2026-03-01' AND inbound_date < '2026-04-01';

DELETE FROM inventory_outbound
WHERE outbound_date >= '2026-03-01' AND outbound_date < '2026-04-01';

DELETE FROM inventory_stock_snapshot
WHERE snapshot_date >= '2026-03-01' AND snapshot_date < '2026-04-01';

-- ---------- 삭제 후 건수(해당 월은 0이어야 함) ----------
SELECT 'after_delete' AS phase, 'inbound_march' AS tbl, COUNT(*) AS cnt FROM inventory_inbound
WHERE inbound_date >= '2026-03-01' AND inbound_date < '2026-04-01'
UNION ALL
SELECT 'after_delete', 'outbound_march', COUNT(*) FROM inventory_outbound
WHERE outbound_date >= '2026-03-01' AND outbound_date < '2026-04-01'
UNION ALL
SELECT 'after_delete', 'snapshot_march', COUNT(*) FROM inventory_stock_snapshot
WHERE snapshot_date >= '2026-03-01' AND snapshot_date < '2026-04-01';

COMMIT;

-- ---------- 선택: 업로드 이력도 정리(감사 로그만, 데이터 아님) ----------
-- BEGIN;
-- DELETE FROM inventory_upload_logs WHERE target_month = '2026-03';
-- COMMIT;

SELECT '2026-03 입고·출고·스냅샷 삭제 완료. 동일 파일을 웹에서 다시 업로드·반영하세요.' AS status;
