-- 업로드 자동 검증 감사 로그 확장 (Supabase SQL Editor)
ALTER TABLE IF EXISTS inventory_upload_logs
  ADD COLUMN IF NOT EXISTS target_month TEXT,
  ADD COLUMN IF NOT EXISTS anomaly_row_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sum_outbound_total_amount NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS sum_total_price NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS sum_unit_price_x_qty NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS source_selection_json JSONB,
  ADD COLUMN IF NOT EXISTS validation_debug_json JSONB;

COMMENT ON COLUMN inventory_upload_logs.target_month IS '대상 월 YYYY-MM (파일명 기준)';
COMMENT ON COLUMN inventory_upload_logs.validation_debug_json IS '검증 상세·디버그 요약 JSON';
