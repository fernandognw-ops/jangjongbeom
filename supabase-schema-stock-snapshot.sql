-- ============================================================
-- 0311 수불 기준 현재 재고 스냅샷 및 품목 구분
-- ============================================================

-- 1. inventory_products에 is_active 추가 (선택)
ALTER TABLE inventory_products
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- 2. 현재 운영 품목 코드 (0311 Rawdata 478건) - is_active 대안
CREATE TABLE IF NOT EXISTS inventory_current_products (
  product_code TEXT PRIMARY KEY,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE inventory_current_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all inventory_current_products" ON inventory_current_products;
CREATE POLICY "Allow all inventory_current_products" ON inventory_current_products FOR ALL USING (true) WITH CHECK (true);

-- 3. 현재 재고 스냅샷 (0311 재고 시트 기준)
CREATE TABLE IF NOT EXISTS inventory_stock_snapshot (
  product_code TEXT PRIMARY KEY,
  quantity INTEGER NOT NULL DEFAULT 0,
  unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  pack_size INTEGER DEFAULT 1,
  total_price NUMERIC(14,2) DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_snapshot_date ON inventory_stock_snapshot(snapshot_date);

-- RLS
ALTER TABLE inventory_stock_snapshot ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all inventory_stock_snapshot" ON inventory_stock_snapshot;
CREATE POLICY "Allow all inventory_stock_snapshot" ON inventory_stock_snapshot FOR ALL USING (true) WITH CHECK (true);
