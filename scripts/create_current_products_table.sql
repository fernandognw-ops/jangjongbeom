-- inventory_current_products 테이블 생성 (대시보드용)
-- Supabase SQL Editor에서 실행하세요.

CREATE TABLE IF NOT EXISTS inventory_current_products (
  product_code TEXT PRIMARY KEY,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE inventory_current_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all inventory_current_products" ON inventory_current_products;
CREATE POLICY "Allow all inventory_current_products" ON inventory_current_products FOR ALL USING (true) WITH CHECK (true);

SELECT 'inventory_current_products 테이블 생성 완료' AS status;
