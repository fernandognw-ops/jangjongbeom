-- ============================================================
-- 서버 부하 최적화: 집계 함수, 인덱스
-- 실행: Supabase SQL Editor에서 이 파일 내용 붙여넣기 후 실행
-- ============================================================

-- 1. 인덱스 추가 (inbound에는 sales_channel 없음)
CREATE INDEX IF NOT EXISTS idx_inv_outbound_product_channel 
  ON inventory_outbound(product_code, sales_channel);
CREATE INDEX IF NOT EXISTS idx_inv_outbound_date_channel 
  ON inventory_outbound(outbound_date, sales_channel);

CREATE INDEX IF NOT EXISTS idx_inv_products_code 
  ON inventory_products(code);

-- 2. 최종 재고 캐시 테이블 (마감 시트 업로드 시 계산 결과 저장)
-- inventory_stock_snapshot이 이미 이 역할을 함. 
-- 추가: inventory_final_stock_cache - 마감일별 최종 재고 (선택)
-- 기존 inventory_stock_snapshot을 "최종 재고"로 사용하므로 별도 테이블은 생략.
-- (production-sheet-upload에서 이미 snapshot에 저장)

-- 3. 월별 출고 집계 함수 (category-trend, forecast용)
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
    sales_channel::TEXT,
    SUM(quantity)::BIGINT AS total_quantity
  FROM inventory_outbound
  WHERE outbound_date >= p_date_from AND outbound_date < p_date_to
  GROUP BY 1, 2, 3
  ORDER BY 1, 2, 3;
$$;

-- 4. 월별 입고 집계 함수 (입고에는 채널 없음 → 'general'로 반환)
CREATE OR REPLACE FUNCTION get_inbound_monthly_agg(
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
    to_char(inbound_date, 'YYYY-MM') AS month_key,
    product_code,
    'general'::TEXT AS sales_channel,
    SUM(quantity)::BIGINT AS total_quantity
  FROM inventory_inbound
  WHERE inbound_date >= p_date_from AND inbound_date < p_date_to
  GROUP BY 1, 2
  ORDER BY 1, 2;
$$;

-- 5. 제품별 최근 N일 출고 합계 (safety, avg, recommended용)
CREATE OR REPLACE FUNCTION get_outbound_product_agg(
  p_days INTEGER DEFAULT 90
)
RETURNS TABLE (
  product_code TEXT,
  total_outbound BIGINT,
  day_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT 
    product_code,
    SUM(quantity)::BIGINT AS total_outbound,
    COUNT(DISTINCT outbound_date)::BIGINT AS day_count
  FROM inventory_outbound
  WHERE outbound_date >= CURRENT_DATE - (p_days || ' days')::INTERVAL
  GROUP BY product_code
  ORDER BY product_code;
$$;

-- 5a. 제품·채널별 입고/출고 누적 합계 (입고는 'general'로 집계)
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

-- 5b. 제품별 입고/출고 누적 합계 (스냅샷 없을 때 재고 계산용)
CREATE OR REPLACE FUNCTION get_inbound_outbound_totals()
RETURNS TABLE (
  product_code TEXT,
  total_inbound BIGINT,
  total_outbound BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT 
    COALESCE(i.product_code, o.product_code) AS product_code,
    COALESCE(i.total_inbound, 0)::BIGINT AS total_inbound,
    COALESCE(o.total_outbound, 0)::BIGINT AS total_outbound
  FROM 
    (SELECT product_code, SUM(quantity) AS total_inbound FROM inventory_inbound GROUP BY product_code) i
  FULL OUTER JOIN 
    (SELECT product_code, SUM(quantity) AS total_outbound FROM inventory_outbound GROUP BY product_code) o
  ON i.product_code = o.product_code
  ORDER BY 1;
$$;

-- 6. 오늘 입고/출고 건수
CREATE OR REPLACE FUNCTION get_today_inout_count()
RETURNS TABLE (
  inbound_count BIGINT,
  outbound_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT 
    (SELECT COUNT(*) FROM inventory_inbound WHERE inbound_date::DATE = CURRENT_DATE)::BIGINT,
    (SELECT COUNT(*) FROM inventory_outbound WHERE outbound_date::DATE = CURRENT_DATE)::BIGINT;
$$;
