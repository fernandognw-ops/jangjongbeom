-- 업로드 반영 이력 테이블
-- 웹 업로드 단일 반영 구조: 모든 적재는 웹 API를 통해서만 수행

CREATE TABLE IF NOT EXISTS inventory_upload_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_by TEXT DEFAULT '',
  inbound_count INTEGER NOT NULL DEFAULT 0,
  outbound_count INTEGER NOT NULL DEFAULT 0,
  stock_count INTEGER NOT NULL DEFAULT 0,
  success BOOLEAN NOT NULL DEFAULT true,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_upload_log_at ON inventory_upload_log(uploaded_at DESC);
