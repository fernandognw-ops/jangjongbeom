-- ============================================================
-- 4단계: 복구 후 검증
-- Supabase SQL Editor에서 실행하세요.
-- ============================================================

-- 1. row 수 확인
SELECT 'inbound' AS tbl, COUNT(*) AS cnt FROM inventory_inbound
UNION ALL SELECT 'outbound', COUNT(*) FROM inventory_outbound
UNION ALL SELECT 'stock', COUNT(*) FROM inventory_stock_snapshot;

-- 2. 재고 총합 금액
SELECT SUM(total_price) AS stock_total_price FROM inventory_stock_snapshot;

-- 3. dest_warehouse(센터) 분포
SELECT dest_warehouse, COUNT(*) AS cnt
FROM inventory_stock_snapshot
GROUP BY dest_warehouse
ORDER BY cnt DESC;

-- 4. 3월 inbound/outbound 건수
SELECT 'inbound_march' AS tbl, COUNT(*) FROM inventory_inbound
WHERE inbound_date >= '2026-03-01' AND inbound_date < '2026-04-01'
UNION ALL
SELECT 'outbound_march', COUNT(*) FROM inventory_outbound
WHERE outbound_date >= '2026-03-01' AND outbound_date < '2026-04-01';

-- 5. 중복 확인 (product_code + date 기준, 0이면 정상)
SELECT 'inbound_dup' AS check_type, (SELECT COUNT(*) FROM (
  SELECT product_code, inbound_date FROM inventory_inbound GROUP BY 1,2 HAVING COUNT(*) > 1
) t) AS dup_row_count
UNION ALL
SELECT 'outbound_dup', (SELECT COUNT(*) FROM (
  SELECT product_code, outbound_date, sales_channel FROM inventory_outbound GROUP BY 1,2,3 HAVING COUNT(*) > 1
) t);
