-- inventory_outbound 채널 = sales_column만 CAST 후 TRIM/LOWER/LIKE (TS `normalizeSalesChannelKr`·`outboundChannelKrFromRow`와 동일)
-- Supabase SQL Editor에서 실행

CREATE OR REPLACE FUNCTION get_outbound_monthly_agg(
  p_date_from DATE DEFAULT '2025-01-01',
  p_date_to DATE DEFAULT CURRENT_DATE + INTERVAL '1 month'
)
RETURNS TABLE (
  month_key TEXT,
  product_code TEXT,
  sales_channel TEXT,
  total_quantity BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    to_char(outbound_date, 'YYYY-MM') AS month_key,
    product_code,
    (CASE
      WHEN LOWER(TRIM(CAST(sales_channel AS TEXT))) LIKE '%쿠팡%' THEN '쿠팡'
      WHEN LOWER(TRIM(CAST(sales_channel AS TEXT))) LIKE '%coupang%' THEN '쿠팡'
      ELSE '일반'
    END)::TEXT AS sales_channel,
    SUM(quantity)::BIGINT AS total_quantity
  FROM inventory_outbound
  WHERE outbound_date >= p_date_from AND outbound_date < p_date_to
  GROUP BY 1, 2, 3
  ORDER BY 1, 2, 3;
$$;

CREATE OR REPLACE FUNCTION get_inbound_outbound_totals_by_channel()
RETURNS TABLE (
  product_code TEXT,
  sales_channel TEXT,
  total_inbound BIGINT,
  total_outbound BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH out_norm AS (
    SELECT
      product_code,
      (CASE
        WHEN LOWER(TRIM(CAST(sales_channel AS TEXT))) LIKE '%쿠팡%' THEN '쿠팡'
        WHEN LOWER(TRIM(CAST(sales_channel AS TEXT))) LIKE '%coupang%' THEN '쿠팡'
        ELSE '일반'
      END)::TEXT AS sales_channel,
      quantity
    FROM inventory_outbound
  ),
  keys AS (
    SELECT product_code, 'general'::TEXT AS sales_channel FROM inventory_inbound GROUP BY 1
    UNION
    SELECT product_code, sales_channel FROM out_norm GROUP BY 1, 2
  ),
  in_agg AS (
    SELECT product_code, 'general'::TEXT AS sales_channel, SUM(quantity)::BIGINT AS total_inbound
    FROM inventory_inbound
    GROUP BY product_code
  ),
  out_agg AS (
    SELECT product_code, sales_channel, SUM(quantity)::BIGINT AS total_outbound
    FROM out_norm
    GROUP BY product_code, sales_channel
  )
  SELECT
    k.product_code,
    k.sales_channel,
    COALESCE(i.total_inbound, 0)::BIGINT,
    COALESCE(o.total_outbound, 0)::BIGINT
  FROM keys k
  LEFT JOIN in_agg i ON k.product_code = i.product_code AND k.sales_channel = i.sales_channel
  LEFT JOIN out_agg o ON k.product_code = o.product_code AND k.sales_channel = o.sales_channel
  ORDER BY 1, 2;
$$;
