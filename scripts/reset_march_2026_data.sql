-- ============================================================
-- 26년 3월 데이터 초기화
-- 26년 2월 28일까지만 유지, 3월 데이터 삭제
-- Supabase 대시보드 > SQL Editor에서 실행하세요.
-- ============================================================

-- 1. 입고: 2026-03-01 이후 데이터 삭제
DELETE FROM inventory_inbound
WHERE inbound_date >= '2026-03-01';

-- 2. 출고: 2026-03-01 이후 데이터 삭제
DELETE FROM inventory_outbound
WHERE outbound_date >= '2026-03-01';

-- 3. 재고 스냅샷: 2026-03-01 이후 날짜를 2026-02-28로 변경
--    (product_code PK라 한 품목당 1행만 존재. 날짜만 2월 말로 표시)
UPDATE inventory_stock_snapshot
SET snapshot_date = '2026-02-28',
    updated_at = NOW()
WHERE snapshot_date >= '2026-03-01';

-- inventory_current_products, inventory_products는 마스터 데이터이므로 변경 없음

-- 실행 결과 확인용 (선택)
-- SELECT 'inbound' AS tbl, COUNT(*) FROM inventory_inbound WHERE inbound_date >= '2026-03-01'
-- UNION ALL
-- SELECT 'outbound', COUNT(*) FROM inventory_outbound WHERE outbound_date >= '2026-03-01';
