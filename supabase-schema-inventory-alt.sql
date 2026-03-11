-- ============================================================
-- 재고 관리 DB 스키마 (기존 products와 충돌 방지)
-- inventory_products, inventory_inbound, inventory_outbound 사용
-- ============================================================

DO $$ BEGIN
  CREATE TYPE sales_channel AS ENUM ('coupang', 'general');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 제품 마스터
CREATE TABLE IF NOT EXISTS inventory_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  group_name TEXT NOT NULL,
  sub_group TEXT DEFAULT '',
  spec TEXT DEFAULT '',
  unit_cost NUMERIC(12,2) DEFAULT 0,
  pack_size INTEGER DEFAULT 1,
  sales_channel sales_channel,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inv_products_group ON inventory_products(group_name);
CREATE INDEX IF NOT EXISTS idx_inv_products_channel ON inventory_products(sales_channel);

-- 입고
CREATE TABLE IF NOT EXISTS inventory_inbound (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  sales_channel sales_channel NOT NULL,
  inbound_date DATE NOT NULL,
  source_warehouse TEXT,
  dest_warehouse TEXT,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (product_code) REFERENCES inventory_products(code)
);

CREATE INDEX IF NOT EXISTS idx_inv_inbound_date ON inventory_inbound(inbound_date DESC);
CREATE INDEX IF NOT EXISTS idx_inv_inbound_product ON inventory_inbound(product_code);

-- 출고
CREATE TABLE IF NOT EXISTS inventory_outbound (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  sales_channel sales_channel NOT NULL,
  outbound_date DATE NOT NULL,
  source_warehouse TEXT,
  dest_warehouse TEXT,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (product_code) REFERENCES inventory_products(code)
);

CREATE INDEX IF NOT EXISTS idx_inv_outbound_date ON inventory_outbound(outbound_date DESC);
CREATE INDEX IF NOT EXISTS idx_inv_outbound_product ON inventory_outbound(product_code);

-- RLS
ALTER TABLE inventory_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_inbound ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_outbound ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all inventory_products" ON inventory_products;
CREATE POLICY "Allow all inventory_products" ON inventory_products FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow all inventory_inbound" ON inventory_inbound;
CREATE POLICY "Allow all inventory_inbound" ON inventory_inbound FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow all inventory_outbound" ON inventory_outbound;
CREATE POLICY "Allow all inventory_outbound" ON inventory_outbound FOR ALL USING (true) WITH CHECK (true);
