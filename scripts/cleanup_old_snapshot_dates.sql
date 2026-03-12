-- ============================================================
-- 2026-02-28 등 구버전 snapshot_date 행 삭제
-- API는 이미 최신 snapshot_date만 사용하므로 선택 실행.
-- Supabase 대시보드 > SQL Editor에서 실행하세요.
-- ============================================================
-- 실행 전 확인: 2026-03-11 데이터가 충분히 있는지 확인 후 진행

-- 삭제 대상 확인 (실행 전 확인용)
SELECT snapshot_date, COUNT(*) AS cnt
FROM inventory_stock_snapshot
GROUP BY snapshot_date
ORDER BY snapshot_date;

-- 2026-02-28 행 삭제 (최신 2026-03-11만 유지하려면)
DELETE FROM inventory_stock_snapshot
WHERE snapshot_date < '2026-03-11';

-- 삭제 후 확인
SELECT snapshot_date, COUNT(*) AS cnt
FROM inventory_stock_snapshot
GROUP BY snapshot_date;
