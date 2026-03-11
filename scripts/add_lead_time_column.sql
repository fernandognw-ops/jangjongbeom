-- ============================================================
-- inventory_products에 lead_time_days 컬럼 추가
-- 발주 후 입고까지 기간(일), 기본값 7일
-- Supabase 대시보드 > SQL Editor에서 실행
-- ============================================================

ALTER TABLE inventory_products
  ADD COLUMN IF NOT EXISTS lead_time_days INTEGER DEFAULT 7;

COMMENT ON COLUMN inventory_products.lead_time_days IS '발주 후 입고까지 기간(일), 기본 7일';
