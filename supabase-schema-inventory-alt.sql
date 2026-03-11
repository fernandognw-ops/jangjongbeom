-- ============================================================
-- 재고 관리 DB 스키마 (기존 products와 충돌 방지)
-- inventory_products, inventory_inbound, inventory_outbound 사용
-- ============================================================

DO $$ BEGIN
  CREATE TYPE sales_channel AS ENUM ('coupang', 'general');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 제품 마스터 (표준 필드: product_code=바코드, product_name=상품명)
CREATE TABLE IF NOT EXISTS inventory_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code TEXT NOT NULL UNIQUE,
  product_name TEXT NOT NULL DEFAULT '',
  group_name TEXT NOT NULL,
  sub_group TEXT DEFAULT '',
  spec TEXT DEFAULT '',
  unit_cost NUMERIC(12,2) DEFAULT 0,
  pack_size INTEGER DEFAULT 1,
  sales_channel sales_channel,
  lead_time_days INTEGER DEFAULT 7,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inv_products_group ON inventory_products(group_name);
CREATE INDEX IF NOT EXISTS idx_inv_products_channel ON inventory_products(sales_channel);

-- 입고 (sales_channel 없음. dest_warehouse = 입고처: 테이칼튼→쿠팡, 제이에스→일반)
CREATE TABLE IF NOT EXISTS inventory_inbound (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  inbound_date DATE NOT NULL,
  source_warehouse TEXT,
  dest_warehouse TEXT,  -- 입고처
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (product_code) REFERENCES inventory_products(product_code)
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
  FOREIGN KEY (product_code) REFERENCES inventory_products(product_code)
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
