-- ============================================================
-- inventory_upload_logs (웹 UI 승인 기반 단일 반영)
-- Supabase SQL Editor에서 실행
-- ============================================================

CREATE TABLE IF NOT EXISTS inventory_upload_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_by TEXT DEFAULT 'web',
  source TEXT NOT NULL DEFAULT 'web',
  filename TEXT NOT NULL,
  snapshot_date TEXT,
  rawdata_count INTEGER NOT NULL DEFAULT 0,
  inbound_count INTEGER NOT NULL DEFAULT 0,
  outbound_count INTEGER NOT NULL DEFAULT 0,
  stock_count INTEGER NOT NULL DEFAULT 0,
  total_value NUMERIC(18,2) DEFAULT 0,
  general_count INTEGER NOT NULL DEFAULT 0,
  coupang_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'success',
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_upload_logs_at ON inventory_upload_logs(uploaded_at DESC);

SELECT 'inventory_upload_logs 테이블 생성 완료' AS status;
