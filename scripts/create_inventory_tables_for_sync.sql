-- ============================================================
-- integrated_sync.py용 테이블 생성
-- Supabase SQL Editor에서 실행하세요.
-- ============================================================

-- 1. inventory_products (rawdata 시트)
CREATE TABLE IF NOT EXISTS inventory_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code TEXT NOT NULL UNIQUE,
  product_name TEXT NOT NULL DEFAULT '',
  group_name TEXT NOT NULL DEFAULT '기타',
  category TEXT DEFAULT '',
  sub_group TEXT DEFAULT '',
  spec TEXT DEFAULT '',
  unit_cost NUMERIC(12,2) DEFAULT 0,
  pack_size INTEGER DEFAULT 1,
  sales_channel TEXT DEFAULT 'general',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. inventory_inbound (입고 시트)
CREATE TABLE IF NOT EXISTS inventory_inbound (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code TEXT NOT NULL,
  product_name TEXT DEFAULT '',
  category TEXT DEFAULT '',
  pack_size INTEGER DEFAULT 1,
  quantity INTEGER NOT NULL,
  dest_warehouse TEXT,
  inbound_date DATE NOT NULL,
  unit_price NUMERIC(12,2) DEFAULT 0,
  total_price NUMERIC(14,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_upsert ON inventory_inbound (product_code, inbound_date);

-- 3. inventory_stock_snapshot (재고 시트) - product_code 단일 PK 또는 (product_code, dest_warehouse)
CREATE TABLE IF NOT EXISTS inventory_stock_snapshot (
  product_code TEXT PRIMARY KEY,
  dest_warehouse TEXT DEFAULT '',
  product_name TEXT DEFAULT '',
  category TEXT DEFAULT '',
  pack_size INTEGER DEFAULT 1,
  quantity INTEGER NOT NULL DEFAULT 0,
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  unit_cost NUMERIC(12,2) DEFAULT 0,
  total_price NUMERIC(14,2) DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. inventory_current_products (대시보드 현재 품목 목록 - stock+inbound+outbound에서 수집)
CREATE TABLE IF NOT EXISTS inventory_current_products (
  product_code TEXT PRIMARY KEY,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE inventory_current_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all inventory_current_products" ON inventory_current_products;
CREATE POLICY "Allow all inventory_current_products" ON inventory_current_products FOR ALL USING (true) WITH CHECK (true);

-- 5. inventory_outbound (출고 시트)
CREATE TABLE IF NOT EXISTS inventory_outbound (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code TEXT NOT NULL,
  product_name TEXT DEFAULT '',
  category TEXT DEFAULT '',
  pack_size INTEGER DEFAULT 1,
  quantity INTEGER NOT NULL,
  dest_warehouse TEXT,
  outbound_date DATE NOT NULL,
  unit_price NUMERIC(12,2) DEFAULT 0,
  total_price NUMERIC(14,2) DEFAULT 0,
  sales_channel TEXT NOT NULL DEFAULT 'general',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_upsert ON inventory_outbound (product_code, outbound_date, sales_channel);

-- RLS
ALTER TABLE inventory_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_inbound ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_stock_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_outbound ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all inventory_products" ON inventory_products;
CREATE POLICY "Allow all inventory_products" ON inventory_products FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow all inventory_inbound" ON inventory_inbound;
CREATE POLICY "Allow all inventory_inbound" ON inventory_inbound FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow all inventory_stock_snapshot" ON inventory_stock_snapshot;
CREATE POLICY "Allow all inventory_stock_snapshot" ON inventory_stock_snapshot FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow all inventory_outbound" ON inventory_outbound;
CREATE POLICY "Allow all inventory_outbound" ON inventory_outbound FOR ALL USING (true) WITH CHECK (true);

SELECT 'inventory 테이블 생성 완료' AS status;
