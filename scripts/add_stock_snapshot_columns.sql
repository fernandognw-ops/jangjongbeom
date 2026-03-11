-- ============================================================
-- inventory_stock_snapshot 컬럼 추가
-- pack_size: 입수량 (박스당 개수)
-- total_price: 재고 금액
-- Supabase SQL Editor에서 실행하세요.
-- ============================================================

ALTER TABLE inventory_stock_snapshot
  ADD COLUMN IF NOT EXISTS pack_size INTEGER DEFAULT 1;

ALTER TABLE inventory_stock_snapshot
  ADD COLUMN IF NOT EXISTS total_price NUMERIC(14,2) DEFAULT 0;

SELECT 'inventory_stock_snapshot 컬럼 추가 완료' AS status;
