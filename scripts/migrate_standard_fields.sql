-- ============================================================
-- 표준 필드명 통일 마이그레이션
-- inventory_products: code→product_code, name→product_name
-- Supabase SQL Editor에서 실행하세요.
-- ============================================================

-- 1. FK 제약 제거
ALTER TABLE inventory_inbound DROP CONSTRAINT IF EXISTS inventory_inbound_product_code_fkey;
ALTER TABLE inventory_inbound DROP CONSTRAINT IF EXISTS inventory_inbound_product_code_inventory_products_code_fkey;
ALTER TABLE inventory_outbound DROP CONSTRAINT IF EXISTS inventory_outbound_product_code_fkey;
ALTER TABLE inventory_outbound DROP CONSTRAINT IF EXISTS inventory_outbound_product_code_inventory_products_code_fkey;

-- 2. inventory_products: code→product_code, name→product_name
-- (이전에 name→product_code 변경했다면: product_code→product_name, code→product_code)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='inventory_products' AND column_name='product_code')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='inventory_products' AND column_name='name') THEN
    ALTER TABLE inventory_products RENAME COLUMN product_code TO product_name;
    ALTER TABLE inventory_products RENAME COLUMN code TO product_code;
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='inventory_products' AND column_name='code')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='inventory_products' AND column_name='name') THEN
    ALTER TABLE inventory_products RENAME COLUMN name TO product_name;
    ALTER TABLE inventory_products RENAME COLUMN code TO product_code;
  END IF;
END $$;

-- 3. product_code Unique 제약
DROP INDEX IF EXISTS inventory_products_code_key;
CREATE UNIQUE INDEX IF NOT EXISTS inventory_products_product_code_key ON inventory_products(product_code);

-- 4. FK 재설정
ALTER TABLE inventory_inbound ADD CONSTRAINT inventory_inbound_product_code_fkey
  FOREIGN KEY (product_code) REFERENCES inventory_products(product_code);
ALTER TABLE inventory_outbound ADD CONSTRAINT inventory_outbound_product_code_fkey
  FOREIGN KEY (product_code) REFERENCES inventory_products(product_code);

SELECT '표준 필드 마이그레이션 완료' AS status;
