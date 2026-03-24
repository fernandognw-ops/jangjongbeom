-- 자동 업로드 반영 로그 확장 컬럼
ALTER TABLE IF EXISTS inventory_upload_logs
  ADD COLUMN IF NOT EXISTS auto_committed BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS validation_passed BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS validation_error_reason TEXT;

UPDATE inventory_upload_logs
SET auto_committed = COALESCE(auto_committed, FALSE),
    validation_passed = CASE WHEN status = 'success' THEN TRUE ELSE FALSE END
WHERE auto_committed IS NULL OR validation_passed IS NULL;
