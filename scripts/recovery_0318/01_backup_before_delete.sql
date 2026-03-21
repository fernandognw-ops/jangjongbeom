-- ============================================================
-- 1단계: 2026-03-18 07:00 KST 이후 적재된 데이터 백업
-- Supabase SQL Editor에서 실행하세요.
-- 실행 전 row count 확인 후 진행.
-- ============================================================
-- 기준 시점: 2026-03-18 07:00:00 KST = 2026-03-17 22:00:00 UTC
-- created_at/updated_at >= '2026-03-18 07:00:00+09' 인 행 백업
-- ============================================================

-- 0. 삭제 대상 row count 사전 확인 (필수)
SELECT 'inbound' AS tbl, COUNT(*) AS cnt
FROM inventory_inbound
WHERE created_at >= '2026-03-18 07:00:00+09'
UNION ALL
SELECT 'outbound', COUNT(*)
FROM inventory_outbound
WHERE created_at >= '2026-03-18 07:00:00+09'
UNION ALL
SELECT 'stock', COUNT(*)
FROM inventory_stock_snapshot
WHERE updated_at >= '2026-03-18 07:00:00+09';

-- 1. inbound 백업 테이블 생성 및 복사
DROP TABLE IF EXISTS inventory_inbound_backup_20260318_recovery;
CREATE TABLE inventory_inbound_backup_20260318_recovery AS
SELECT * FROM inventory_inbound
WHERE created_at >= '2026-03-18 07:00:00+09';
SELECT 'inbound_backup' AS tbl, COUNT(*) AS cnt FROM inventory_inbound_backup_20260318_recovery;

-- 2. outbound 백업 테이블 생성 및 복사
DROP TABLE IF EXISTS inventory_outbound_backup_20260318_recovery;
CREATE TABLE inventory_outbound_backup_20260318_recovery AS
SELECT * FROM inventory_outbound
WHERE created_at >= '2026-03-18 07:00:00+09';
SELECT 'outbound_backup' AS tbl, COUNT(*) AS cnt FROM inventory_outbound_backup_20260318_recovery;

-- 3. stock 백업 테이블 생성 및 복사
DROP TABLE IF EXISTS inventory_stock_snapshot_backup_20260318_recovery;
CREATE TABLE inventory_stock_snapshot_backup_20260318_recovery AS
SELECT * FROM inventory_stock_snapshot
WHERE updated_at >= '2026-03-18 07:00:00+09';
SELECT 'stock_backup' AS tbl, COUNT(*) AS cnt FROM inventory_stock_snapshot_backup_20260318_recovery;

-- 4. 당월(3월) 데이터만 영향받는 경우: inbound_date/outbound_date 기준 백업 (선택)
--    sync가 당월만 삭제 후 upsert하므로, 3월 데이터 전체가 잘못되었을 수 있음
--    아래는 3월 inbound/outbound 전체 백업 (created_at 무관)
DROP TABLE IF EXISTS inventory_inbound_march_backup_20260318_recovery;
CREATE TABLE inventory_inbound_march_backup_20260318_recovery AS
SELECT * FROM inventory_inbound WHERE inbound_date >= '2026-03-01' AND inbound_date < '2026-04-01';
SELECT 'inbound_march_backup' AS tbl, COUNT(*) AS cnt FROM inventory_inbound_march_backup_20260318_recovery;

DROP TABLE IF EXISTS inventory_outbound_march_backup_20260318_recovery;
CREATE TABLE inventory_outbound_march_backup_20260318_recovery AS
SELECT * FROM inventory_outbound WHERE outbound_date >= '2026-03-01' AND outbound_date < '2026-04-01';
SELECT 'outbound_march_backup' AS tbl, COUNT(*) AS cnt FROM inventory_outbound_march_backup_20260318_recovery;

SELECT '백업 완료. 02_delete_bad_data.sql 실행 전 위 row count 확인하세요.' AS status;
