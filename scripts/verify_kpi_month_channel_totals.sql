-- 대시보드 category-trend KPI(당월 수량)와 DB를 맞춰볼 때 사용.
-- :ym 에 검증할 월을 넣어 실행 (예: 2026-03).
-- 대시보드 상단 "총입고/총판매" = 아래 total_qty (해당 월 전체, 채널 무관 합).
-- 하단 "일반/쿠팡" = sales_channel 텍스트 기준 GROUP BY (API의 채널 분해와 동일하게 보려면
--   애플리케이션의 normalizeSalesChannelKr / outboundChannelKrFromRow 규칙과 컬럼 값이 일치해야 함).

-- \set ym '2026-03'  -- psql인 경우

WITH params AS (
  SELECT '2026-03'::text AS ym  -- ← 여기 월만 바꿔서 실행
),
out_m AS (
  SELECT
    to_char(outbound_date, 'YYYY-MM') AS ym,
    CAST(sales_channel AS text) AS sales_channel_raw,
    SUM(quantity) AS qty_sum,
    COUNT(*) AS row_cnt,
    COUNT(*) FILTER (WHERE source_row_key IS NULL) AS rows_null_key
  FROM inventory_outbound
  WHERE to_char(outbound_date, 'YYYY-MM') = (SELECT ym FROM params)
  GROUP BY 1, 2
),
in_m AS (
  SELECT
    to_char(inbound_date, 'YYYY-MM') AS ym,
    CAST(sales_channel AS text) AS sales_channel_raw,
    SUM(quantity) AS qty_sum,
    COUNT(*) AS row_cnt,
    COUNT(*) FILTER (WHERE source_row_key IS NULL) AS rows_null_key
  FROM inventory_inbound
  WHERE to_char(inbound_date, 'YYYY-MM') = (SELECT ym FROM params)
  GROUP BY 1, 2
)
SELECT 'outbound_by_raw_sales_channel' AS section, o.*
FROM out_m o
UNION ALL
SELECT 'inbound_by_raw_sales_channel', i.ym::text, i.sales_channel_raw, i.qty_sum, i.row_cnt, i.rows_null_key
FROM in_m i
UNION ALL
SELECT 'outbound_month_total', (SELECT ym FROM params), '(all channels)', SUM(qty_sum), SUM(row_cnt), SUM(rows_null_key)
FROM out_m
UNION ALL
SELECT 'inbound_month_total', (SELECT ym FROM params), '(all channels)', SUM(qty_sum), SUM(row_cnt), SUM(rows_null_key)
FROM in_m
ORDER BY section, sales_channel_raw NULLS LAST;
