-- ============================================================
-- snapshot_date를 2026-03-11로 복원
-- reset_march_2026_data.sql 실행 후 2026-02-28로 바뀐 재고 스냅샷 날짜 복구
-- Supabase 대시보드 > SQL Editor에서 실행하세요.
-- ============================================================
-- 주의: 수량/금액 데이터가 0311 기준이어야 함. 의심되면 sync_0311_current.py 재실행 권장.

UPDATE inventory_stock_snapshot
SET snapshot_date = '2026-03-11',
    updated_at = NOW()
WHERE snapshot_date = '2026-02-28';

-- 확인
SELECT snapshot_date, COUNT(*) AS cnt
FROM inventory_stock_snapshot
GROUP BY snapshot_date;
