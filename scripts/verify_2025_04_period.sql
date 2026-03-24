-- 2025-04 업로드 전후 DB 점검 (Supabase SQL Editor)
-- 스냅샷: snapshot_date별 건수·수량·금액
-- 출고: outbound_date별 건수·수량·금액
-- 중복: product_code + outbound_date + sales_channel

-- 1) inventory_stock_snapshot — 2025-04 구간 (snapshot_date >= '2025-04-01' AND < '2025-05-01')
SELECT
  snapshot_date::date AS d,
  COUNT(*) AS row_cnt,
  COALESCE(SUM(quantity), 0)::bigint AS qty_sum,
  COALESCE(SUM(quantity * COALESCE(unit_cost, 0)), 0)::numeric(20, 2) AS amount_sum
FROM inventory_stock_snapshot
WHERE snapshot_date >= '2025-04-01'
  AND snapshot_date < '2025-05-01'
GROUP BY snapshot_date::date
ORDER BY d;

-- 2) inventory_outbound — 2025-04
SELECT
  outbound_date::date AS d,
  COUNT(*) AS row_cnt,
  COALESCE(SUM(quantity), 0)::bigint AS qty_sum,
  COALESCE(SUM(COALESCE(total_price, 0)), 0)::numeric(20, 2) AS amount_sum
FROM inventory_outbound
WHERE outbound_date >= '2025-04-01'
  AND outbound_date < '2025-05-01'
GROUP BY outbound_date::date
ORDER BY d;

-- 3) 출고 중복 (동일 키 2건 이상)
SELECT
  product_code,
  outbound_date::date AS d,
  sales_channel,
  COUNT(*) AS dup_cnt
FROM inventory_outbound
WHERE outbound_date >= '2025-04-01'
  AND outbound_date < '2025-05-01'
GROUP BY product_code, outbound_date::date, sales_channel
HAVING COUNT(*) > 1
ORDER BY dup_cnt DESC, product_code
LIMIT 200;
