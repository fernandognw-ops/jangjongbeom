-- ============================================================
-- 재고 관리 DB 스키마 (PostgreSQL / Supabase)
-- '0310_생산수불현황' Excel 구조 기반
-- 쿠팡/일반 매출 분리, 1년+ 시계열 분석 지원
-- ============================================================

-- 매출 구분: 쿠팡(Coupang 물류) vs 일반(제이에스, CJ 등)
CREATE TYPE sales_channel AS ENUM ('coupang', 'general');

-- 제품 마스터 (Rawdata 시트)
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,           -- 품목코드 (8809912474938 등)
  name TEXT NOT NULL,                  -- 제품명
  group_name TEXT NOT NULL,            -- 품목구분 (마스크, 캡슐세제, 섬유유연제, 액상세제, 생활용품)
  sub_group TEXT DEFAULT '',           -- 하위품목
  spec TEXT DEFAULT '',               -- 규격 (대형, 25매, 3L 등)
  unit_cost NUMERIC(12,2) DEFAULT 0,   -- 원가 (개당)
  pack_size INTEGER DEFAULT 1,         -- 입수량 (SKU 단위)
  sales_channel sales_channel,         -- 기본 매출구분 (일반/쿠팡)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_products_group ON products(group_name);
CREATE INDEX idx_products_sales_channel ON products(sales_channel);

-- 입고 내역 (입고 시트)
CREATE TABLE IF NOT EXISTS inbound (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  sales_channel sales_channel NOT NULL,
  inbound_date DATE NOT NULL,
  source_warehouse TEXT,               -- 출고처 (테이칼튼 등)
  dest_warehouse TEXT,                 -- 입고처 (제이에스, 쿠팡 등)
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (product_code) REFERENCES products(code)
);

CREATE INDEX idx_inbound_date ON inbound(inbound_date DESC);
CREATE INDEX idx_inbound_sales_channel ON inbound(sales_channel);
CREATE INDEX idx_inbound_product ON inbound(product_code);

-- 출고 내역 (출고 시트)
CREATE TABLE IF NOT EXISTS outbound (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  sales_channel sales_channel NOT NULL,
  outbound_date DATE NOT NULL,
  source_warehouse TEXT,               -- 출고처
  dest_warehouse TEXT,                 -- 입고처 (물류센터)
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (product_code) REFERENCES products(code)
);

CREATE INDEX idx_outbound_date ON outbound(outbound_date DESC);
CREATE INDEX idx_outbound_sales_channel ON outbound(sales_channel);
CREATE INDEX idx_outbound_product ON outbound(product_code);

-- 일별 재고 스냅샷 (재고 시트 - 시계열)
CREATE TABLE IF NOT EXISTS stock_snapshot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date DATE NOT NULL,
  product_code TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  sales_channel sales_channel NOT NULL,
  warehouse TEXT,                      -- 창고명 (제이에스 등)
  unit_price NUMERIC(12,2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(snapshot_date, product_code, sales_channel)
);

CREATE INDEX idx_stock_snapshot_date ON stock_snapshot(snapshot_date DESC);
CREATE INDEX idx_stock_snapshot_product ON stock_snapshot(product_code);
CREATE INDEX idx_stock_snapshot_channel ON stock_snapshot(sales_channel);

-- 물류센터 마감 시차 설정 (쿠팡 vs 일반)
CREATE TABLE IF NOT EXISTS logistics_cutoff_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_channel sales_channel NOT NULL UNIQUE,
  cutoff_hour INTEGER NOT NULL,        -- 마감 시 (0-23)
  cutoff_minute INTEGER DEFAULT 0,     -- 마감 분
  timezone_offset_hours INTEGER DEFAULT 9,  -- KST = +9
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 기본값: 쿠팡 18:00, 일반 23:59
INSERT INTO logistics_cutoff_config (sales_channel, cutoff_hour, cutoff_minute, description)
VALUES 
  ('coupang', 18, 0, '쿠팡 물류센터 당일 마감'),
  ('general', 23, 59, '일반 채널 당일 마감')
ON CONFLICT (sales_channel) DO NOTHING;

-- ============================================================
-- 분석용 뷰: 채널별 일별 출고 합계
-- ============================================================
CREATE OR REPLACE VIEW v_daily_outbound_by_channel AS
SELECT 
  outbound_date AS date,
  sales_channel,
  p.group_name,
  SUM(o.quantity) AS total_quantity,
  COUNT(*) AS transaction_count
FROM outbound o
JOIN products p ON o.product_code = p.code
GROUP BY outbound_date, sales_channel, p.group_name;

-- 채널별 일별 입고 합계
CREATE OR REPLACE VIEW v_daily_inbound_by_channel AS
SELECT 
  inbound_date AS date,
  sales_channel,
  p.group_name,
  SUM(i.quantity) AS total_quantity,
  COUNT(*) AS transaction_count
FROM inbound i
JOIN products p ON i.product_code = p.code
GROUP BY inbound_date, sales_channel, p.group_name;

-- ============================================================
-- RLS (Row Level Security) - 기존 inventory_sync와 병행
-- ============================================================
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbound ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbound ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_snapshot ENABLE ROW LEVEL SECURITY;

-- 익명/인증 사용자 전체 접근 (기존 정책과 동일)
CREATE POLICY "Allow all products" ON products FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all inbound" ON inbound FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all outbound" ON outbound FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all stock_snapshot" ON stock_snapshot FOR ALL USING (true) WITH CHECK (true);
