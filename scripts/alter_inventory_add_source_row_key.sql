-- 원본행 단위 업서트 키 (동일 파일 재업로드 시 중복 삽입 방지)
-- Supabase SQL Editor에서 실행하세요.

ALTER TABLE inventory_inbound ADD COLUMN IF NOT EXISTS source_row_key TEXT;
ALTER TABLE inventory_outbound ADD COLUMN IF NOT EXISTS source_row_key TEXT;
ALTER TABLE inventory_stock_snapshot ADD COLUMN IF NOT EXISTS source_row_key TEXT;

-- legacy 행은 source_row_key NULL 허용(PG unique: NULL은 서로 다름). 신규 적재는 항상 키 설정.
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_inbound_source_row_key
  ON inventory_inbound (source_row_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_outbound_source_row_key
  ON inventory_outbound (source_row_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_stock_snapshot_source_row_key
  ON inventory_stock_snapshot (source_row_key);

SELECT 'source_row_key 컬럼 및 부분 유니크 인덱스 적용 완료' AS status;
