-- 채널별 집계 함수 추가 (Summary API 채널별 데이터용)
-- inventory_inbound에는 sales_channel 없음 → 입고는 'general'로 집계
-- Supabase SQL Editor에서 실행

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
  WITH keys AS (
    SELECT product_code, 'general'::TEXT AS sales_channel FROM inventory_inbound GROUP BY 1
    UNION
    SELECT product_code, sales_channel::TEXT FROM inventory_outbound GROUP BY 1, 2
  ),
  in_agg AS (
    SELECT product_code, 'general'::TEXT AS sales_channel, SUM(quantity)::BIGINT AS total_inbound
    FROM inventory_inbound GROUP BY product_code
  ),
  out_agg AS (
    SELECT product_code, sales_channel::TEXT AS sales_channel, SUM(quantity)::BIGINT AS total_outbound
    FROM inventory_outbound GROUP BY product_code, sales_channel
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
