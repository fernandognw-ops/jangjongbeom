-- ============================================================
-- 입고·출고·재고 테이블 공통 컬럼 추가
-- product_name, category, pack_size, unit_price, total_price
-- 이미 있으면 무시 (ADD COLUMN IF NOT EXISTS)
-- Supabase SQL Editor에서 실행하세요.
-- ============================================================

-- 1. inventory_stock_snapshot
ALTER TABLE inventory_stock_snapshot ADD COLUMN IF NOT EXISTS product_name TEXT DEFAULT '';
ALTER TABLE inventory_stock_snapshot ADD COLUMN IF NOT EXISTS category TEXT DEFAULT '';
ALTER TABLE inventory_stock_snapshot ADD COLUMN IF NOT EXISTS pack_size INTEGER DEFAULT 1;
ALTER TABLE inventory_stock_snapshot ADD COLUMN IF NOT EXISTS unit_price NUMERIC(12,2) DEFAULT 0;
ALTER TABLE inventory_stock_snapshot ADD COLUMN IF NOT EXISTS total_price NUMERIC(14,2) DEFAULT 0;
ALTER TABLE inventory_stock_snapshot ADD COLUMN IF NOT EXISTS dest_warehouse TEXT DEFAULT '';  -- 창고명(동일)

-- 2. inventory_inbound
ALTER TABLE inventory_inbound ADD COLUMN IF NOT EXISTS product_name TEXT DEFAULT '';
ALTER TABLE inventory_inbound ADD COLUMN IF NOT EXISTS category TEXT DEFAULT '';
ALTER TABLE inventory_inbound ADD COLUMN IF NOT EXISTS pack_size INTEGER DEFAULT 1;
ALTER TABLE inventory_inbound ADD COLUMN IF NOT EXISTS unit_price NUMERIC(12,2) DEFAULT 0;
ALTER TABLE inventory_inbound ADD COLUMN IF NOT EXISTS total_price NUMERIC(14,2) DEFAULT 0;

-- 3. inventory_outbound
ALTER TABLE inventory_outbound ADD COLUMN IF NOT EXISTS product_name TEXT DEFAULT '';
ALTER TABLE inventory_outbound ADD COLUMN IF NOT EXISTS category TEXT DEFAULT '';
ALTER TABLE inventory_outbound ADD COLUMN IF NOT EXISTS pack_size INTEGER DEFAULT 1;
ALTER TABLE inventory_outbound ADD COLUMN IF NOT EXISTS unit_price NUMERIC(12,2) DEFAULT 0;
ALTER TABLE inventory_outbound ADD COLUMN IF NOT EXISTS total_price NUMERIC(14,2) DEFAULT 0;

SELECT '공통 컬럼 추가 완료' AS status;
