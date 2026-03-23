-- ============================================================
-- 2026-03 출고 금액 검증 (Supabase SQL Editor)
-- 대시보드 당월 출고 금액 vs SUM(total_price) 불일치 조사용
-- ============================================================

-- 1) 2026-03 전체
SELECT
  COUNT(*) AS row_count,
  SUM(quantity) AS qty_sum,
  SUM(COALESCE(total_price, 0)) AS sum_total_price,
  SUM(quantity * COALESCE(unit_price, 0)) AS sum_qty_times_stored_unit_price
FROM inventory_outbound
WHERE outbound_date >= '2026-03-01' AND outbound_date < '2026-04-01';

-- 2) 2026-03 일자별
SELECT
  outbound_date::date AS d,
  COUNT(*) AS row_count,
  SUM(quantity) AS qty_sum,
  SUM(COALESCE(total_price, 0)) AS amount_sum
FROM inventory_outbound
WHERE outbound_date >= '2026-03-01' AND outbound_date < '2026-04-01'
GROUP BY outbound_date::date
ORDER BY d;

-- 3) product_code + outbound_date + sales_channel 중복
SELECT
  product_code,
  outbound_date::date AS d,
  sales_channel,
  COUNT(*) AS n,
  SUM(quantity) AS qty_sum,
  SUM(COALESCE(total_price, 0)) AS amt_sum
FROM inventory_outbound
WHERE outbound_date >= '2026-03-01' AND outbound_date < '2026-04-01'
GROUP BY product_code, outbound_date::date, sales_channel
HAVING COUNT(*) > 1
ORDER BY n DESC;

-- 4) 마스터 원가로 재계산 vs DB total_price 차이 (진단)
-- inventory_products.unit_cost 조인
SELECT
  SUM(o.quantity * COALESCE(p.unit_cost, 0)) AS implied_qty_times_master_cost,
  SUM(COALESCE(o.total_price, 0)) AS sum_stored_total_price
FROM inventory_outbound o
LEFT JOIN inventory_products p ON p.product_code = o.product_code
WHERE o.outbound_date >= '2026-03-01' AND o.outbound_date < '2026-04-01';
