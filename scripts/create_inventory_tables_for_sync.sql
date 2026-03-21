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
-- 입고: 1 row = 1 입고 행 (병합 없음). PK는 id(uuid).
-- CREATE UNIQUE INDEX 제거됨 - 동일 품목·날짜에 여러 행 허용
CREATE INDEX IF NOT EXISTS idx_inv_inbound_date ON inventory_inbound(inbound_date DESC);
CREATE INDEX IF NOT EXISTS idx_inv_inbound_product ON inventory_inbound(product_code);
CREATE INDEX IF NOT EXISTS idx_inv_inbound_warehouse ON inventory_inbound(dest_warehouse);

-- 3. inventory_stock_snapshot (재고 시트) - 날짜·판매채널·보관센터별 행
-- dest_warehouse = 엑셀 「판매 채널」→ 쿠팡|일반, storage_center = 「보관 센터」
-- sales_channel = 레거시 호환(신규 적재 시 dest_warehouse와 동일)
CREATE TABLE IF NOT EXISTS inventory_stock_snapshot (
  product_code TEXT NOT NULL,
  dest_warehouse TEXT NOT NULL DEFAULT '일반',
  storage_center TEXT NOT NULL DEFAULT '미지정',
  sales_channel TEXT NOT NULL DEFAULT '일반',
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  product_name TEXT DEFAULT '',
  category TEXT DEFAULT '',
  pack_size INTEGER DEFAULT 1,
  quantity INTEGER NOT NULL DEFAULT 0,
  unit_cost NUMERIC(12,2) DEFAULT 0,
  total_price NUMERIC(14,2) DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (product_code, dest_warehouse, storage_center, snapshot_date)
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
-- 출고: 1 row = 1 트랜잭션 (병합 없음). PK는 id(uuid).
-- CREATE UNIQUE INDEX 제거됨 - 동일 품목·날짜·창고에 여러 행 허용
CREATE INDEX IF NOT EXISTS idx_inv_outbound_date ON inventory_outbound(outbound_date DESC);
CREATE INDEX IF NOT EXISTS idx_inv_outbound_product ON inventory_outbound(product_code);
CREATE INDEX IF NOT EXISTS idx_inv_outbound_channel ON inventory_outbound(sales_channel);

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
