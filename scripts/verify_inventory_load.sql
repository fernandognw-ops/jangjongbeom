-- ============================================================
-- 수불 적재 검증용 (Supabase SQL Editor)
-- inventory_stock_snapshot / inventory_outbound / inventory_inbound
-- ============================================================

-- 1) 재고 스냅샷: snapshot_date별 행 수 / 수량 / 금액
SELECT
  snapshot_date,
  COUNT(*) AS row_count,
  SUM(quantity) AS qty_sum,
  SUM(COALESCE(total_price, 0)) AS amount_sum
FROM inventory_stock_snapshot
GROUP BY snapshot_date
ORDER BY snapshot_date;

-- 2) 출고: outbound_date별 행 수 / 수량 / 금액
SELECT
  outbound_date,
  COUNT(*) AS row_count,
  SUM(quantity) AS qty_sum,
  SUM(COALESCE(total_price, 0)) AS amount_sum
FROM inventory_outbound
GROUP BY outbound_date
ORDER BY outbound_date;

-- 3) 입고: inbound_date별 행 수 / 수량 / 금액
SELECT
  inbound_date,
  COUNT(*) AS row_count,
  SUM(quantity) AS qty_sum,
  SUM(COALESCE(total_price, 0)) AS amount_sum
FROM inventory_inbound
GROUP BY inbound_date
ORDER BY inbound_date;

-- 4) 카테고리별 출고 수량 월합 (출고일 기준)
SELECT
  date_trunc('month', outbound_date)::date AS month_start,
  COALESCE(NULLIF(TRIM(category), ''), '기타') AS category,
  SUM(quantity) AS outbound_qty_sum,
  COUNT(*) AS row_count
FROM inventory_outbound
GROUP BY 1, 2
ORDER BY 1, 2;

-- 5) 동일 날짜·동일 키 중복 점검 (재고 PK 위반 여부)
SELECT
  product_code,
  dest_warehouse,
  storage_center,
  snapshot_date,
  COUNT(*) AS n
FROM inventory_stock_snapshot
GROUP BY 1, 2, 3, 4
HAVING COUNT(*) > 1;

-- 6) 출고 동일 키(품목+일자+채널) 중복 — upsert/재실행 누적 의심 시
SELECT
  product_code,
  outbound_date,
  sales_channel,
  COUNT(*) AS n
FROM inventory_outbound
GROUP BY 1, 2, 3
HAVING COUNT(*) > 1;
