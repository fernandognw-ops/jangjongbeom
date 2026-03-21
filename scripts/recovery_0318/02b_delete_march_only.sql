-- ============================================================
-- 2b단계 (선택): 3월 inbound/outbound 전체 삭제
-- sync가 "당월만 삭제 후 upsert"하므로, 3월 데이터가 잘못되었다면
-- created_at 기준이 아닌 inbound_date/outbound_date 기준으로 삭제해야 함.
-- stock은 product_code 단일 PK로 전체 교체되므로 02에서 처리.
-- ============================================================
-- ⚠️ 01_backup 실행 후, 02 대신 이 스크립트를 사용할 수 있음.
--    또는 02 실행 후 3월 데이터가 여전히 잘못되어 있으면 이 스크립트 실행.
-- ============================================================

-- 삭제 대상 확인
SELECT 'inbound_march' AS tbl, COUNT(*) AS cnt FROM inventory_inbound
WHERE inbound_date >= '2026-03-01' AND inbound_date < '2026-04-01'
UNION ALL
SELECT 'outbound_march', COUNT(*) FROM inventory_outbound
WHERE outbound_date >= '2026-03-01' AND outbound_date < '2026-04-01';

-- 3월 inbound 삭제
DELETE FROM inventory_inbound
WHERE inbound_date >= '2026-03-01' AND inbound_date < '2026-04-01';

-- 3월 outbound 삭제
DELETE FROM inventory_outbound
WHERE outbound_date >= '2026-03-01' AND outbound_date < '2026-04-01';

SELECT '3월 inbound/outbound 삭제 완료.' AS status;
