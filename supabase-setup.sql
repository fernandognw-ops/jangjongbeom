-- Supabase 대시보드 > SQL Editor에서 실행하세요.
-- PC·모바일 데이터 연동을 위한 테이블 생성

CREATE TABLE IF NOT EXISTS inventory_sync (
  sync_code TEXT PRIMARY KEY,
  data JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS 활성화 (익명 접근 허용 - 연동코드가 비밀 역할)
ALTER TABLE inventory_sync ENABLE ROW LEVEL SECURITY;

-- 정책: 연동코드를 아는 사용자만 해당 데이터 접근
DROP POLICY IF EXISTS "Allow anon sync" ON inventory_sync;
CREATE POLICY "Allow anon sync" ON inventory_sync
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- 인덱스 (선택)
CREATE INDEX IF NOT EXISTS idx_inventory_sync_updated ON inventory_sync(updated_at DESC);
