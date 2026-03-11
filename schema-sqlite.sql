-- ============================================================
-- 재고 관리 DB 스키마 (SQLite)
-- '0310_생산수불현황' Excel 구조 기반
-- 쿠팡/일반 매출 분리, 1년+ 시계열 분석 지원
-- ============================================================
-- SQLite는 ENUM 미지원 → sales_channel TEXT CHECK IN ('coupang','general')

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  group_name TEXT NOT NULL,
  sub_group TEXT DEFAULT '',
  spec TEXT DEFAULT '',
  unit_cost REAL DEFAULT 0,
  pack_size INTEGER DEFAULT 1,
  sales_channel TEXT CHECK(sales_channel IN ('coupang','general')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_products_group ON products(group_name);
CREATE INDEX IF NOT EXISTS idx_products_sales_channel ON products(sales_channel);

CREATE TABLE IF NOT EXISTS inbound (
  id TEXT PRIMARY KEY,
  product_code TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  sales_channel TEXT NOT NULL CHECK(sales_channel IN ('coupang','general')),
  inbound_date TEXT NOT NULL,
  source_warehouse TEXT,
  dest_warehouse TEXT,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (product_code) REFERENCES products(code)
);

CREATE INDEX IF NOT EXISTS idx_inbound_date ON inbound(inbound_date DESC);
CREATE INDEX IF NOT EXISTS idx_inbound_sales_channel ON inbound(sales_channel);
CREATE INDEX IF NOT EXISTS idx_inbound_product ON inbound(product_code);

CREATE TABLE IF NOT EXISTS outbound (
  id TEXT PRIMARY KEY,
  product_code TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  sales_channel TEXT NOT NULL CHECK(sales_channel IN ('coupang','general')),
  outbound_date TEXT NOT NULL,
  source_warehouse TEXT,
  dest_warehouse TEXT,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (product_code) REFERENCES products(code)
);

CREATE INDEX IF NOT EXISTS idx_outbound_date ON outbound(outbound_date DESC);
CREATE INDEX IF NOT EXISTS idx_outbound_sales_channel ON outbound(sales_channel);
CREATE INDEX IF NOT EXISTS idx_outbound_product ON outbound(product_code);

CREATE TABLE IF NOT EXISTS stock_snapshot (
  id TEXT PRIMARY KEY,
  snapshot_date TEXT NOT NULL,
  product_code TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  sales_channel TEXT NOT NULL CHECK(sales_channel IN ('coupang','general')),
  warehouse TEXT,
  unit_price REAL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(snapshot_date, product_code, sales_channel)
);

CREATE INDEX IF NOT EXISTS idx_stock_snapshot_date ON stock_snapshot(snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_stock_snapshot_product ON stock_snapshot(product_code);
CREATE INDEX IF NOT EXISTS idx_stock_snapshot_channel ON stock_snapshot(sales_channel);

CREATE TABLE IF NOT EXISTS logistics_cutoff_config (
  id TEXT PRIMARY KEY,
  sales_channel TEXT NOT NULL UNIQUE CHECK(sales_channel IN ('coupang','general')),
  cutoff_hour INTEGER NOT NULL,
  cutoff_minute INTEGER DEFAULT 0,
  timezone_offset_hours INTEGER DEFAULT 9,
  description TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO logistics_cutoff_config (id, sales_channel, cutoff_hour, cutoff_minute, description)
VALUES 
  ('cfg-coupang', 'coupang', 18, 0, '쿠팡 물류센터 당일 마감'),
  ('cfg-general', 'general', 23, 59, '일반 채널 당일 마감');
