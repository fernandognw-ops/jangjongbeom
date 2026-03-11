-- ============================================================
-- 단종품목 재고 스냅샷 테이블
-- inventory_products에 없는 품목의 재고를 별도 저장 (FK 없음)
-- dest_warehouse 창고 분류: 테이칼튼/테이칼튼1공장=쿠팡, 제이에스/컬리=일반 (동일 규칙)
-- Supabase SQL Editor에서 실행하세요.
-- ============================================================

CREATE TABLE IF NOT EXISTS inventory_discontinued_stock_snapshot (
  product_code TEXT NOT NULL,
  dest_warehouse TEXT NOT NULL DEFAULT '제이에스',
  product_name TEXT,
  category TEXT DEFAULT '기타',
  quantity INTEGER NOT NULL DEFAULT 0,
  unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  pack_size INTEGER DEFAULT 1,
  total_price NUMERIC(14,2) DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (product_code, dest_warehouse)
);

ALTER TABLE inventory_discontinued_stock_snapshot ADD COLUMN IF NOT EXISTS product_name TEXT;
ALTER TABLE inventory_discontinued_stock_snapshot ADD COLUMN IF NOT EXISTS category TEXT DEFAULT '기타';
ALTER TABLE inventory_discontinued_stock_snapshot ADD COLUMN IF NOT EXISTS pack_size INTEGER DEFAULT 1;
ALTER TABLE inventory_discontinued_stock_snapshot ADD COLUMN IF NOT EXISTS total_price NUMERIC(14,2) DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_discontinued_snapshot_date ON inventory_discontinued_stock_snapshot(snapshot_date);

ALTER TABLE inventory_discontinued_stock_snapshot ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all inventory_discontinued_stock_snapshot" ON inventory_discontinued_stock_snapshot;
CREATE POLICY "Allow all inventory_discontinued_stock_snapshot" ON inventory_discontinued_stock_snapshot FOR ALL USING (true) WITH CHECK (true);

SELECT 'inventory_discontinued_stock_snapshot 테이블 생성 완료' AS status;
