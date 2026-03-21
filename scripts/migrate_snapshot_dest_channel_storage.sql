-- ============================================================
-- inventory_stock_snapshot: 의미 정리
--   dest_warehouse  = 엑셀 「판매 채널」→ "쿠팡" | "일반"
--   storage_center  = 엑셀 「보관 센터」(실제 창고명)
--   sales_channel   = 레거시 호환(신규 적재 시 dest_warehouse와 동일 값 권장)
--
-- 기존 DB에 보관센터명이 dest_warehouse에 들어가 있었다면 데이터 의미가 틀립니다.
-- → TRUNCATE inventory_stock_snapshot 후 동일 엑셀 재업로드를 권장합니다.
-- Supabase SQL Editor에서 실행하세요.
-- ============================================================

-- 1) 보관센터 컬럼
ALTER TABLE inventory_stock_snapshot
  ADD COLUMN IF NOT EXISTS storage_center TEXT NOT NULL DEFAULT '미지정';

-- 2) 기존 PK 제거 (이름이 다를 수 있음 — 오류 시 \d inventory_stock_snapshot 로 확인)
ALTER TABLE inventory_stock_snapshot DROP CONSTRAINT IF EXISTS inventory_stock_snapshot_pkey;

-- 3) (선택) 레거시 행 보정 — TRUNCATE 대신 이전에 물리창고가 dest에 있던 경우에만 검토
-- UPDATE inventory_stock_snapshot s
-- SET
--   storage_center = COALESCE(NULLIF(TRIM(dest_warehouse), ''), '미지정'),
--   dest_warehouse = COALESCE(NULLIF(TRIM(sales_channel), ''), '일반')
-- WHERE ... ;

-- 4) 빈 dest_warehouse 방지
UPDATE inventory_stock_snapshot
SET dest_warehouse = COALESCE(NULLIF(TRIM(dest_warehouse), ''), '일반')
WHERE dest_warehouse IS NULL OR TRIM(dest_warehouse) = '';

-- 5) 신규 복합 PK (품목 × 판매채널 × 보관센터 × 스냅샷일)
--    중복 키 오류 시: 잘못 적재된 기존 데이터이므로 TRUNCATE 후 재업로드
ALTER TABLE inventory_stock_snapshot
  ADD PRIMARY KEY (product_code, dest_warehouse, storage_center, snapshot_date);

SELECT 'migrate_snapshot_dest_channel_storage 완료' AS status;
