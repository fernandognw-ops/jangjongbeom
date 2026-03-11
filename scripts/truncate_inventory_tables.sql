-- ============================================================
-- 재고 시스템 데이터 초기화 (Clean Slate)
-- inventory_products, inventory_inbound, inventory_outbound, inventory_stock_snapshot
-- ============================================================
-- Supabase SQL Editor에서 실행하세요.

-- FK 순서: inbound/outbound → products
TRUNCATE TABLE inventory_inbound CASCADE;
TRUNCATE TABLE inventory_outbound CASCADE;
TRUNCATE TABLE inventory_stock_snapshot CASCADE;
TRUNCATE TABLE inventory_products CASCADE;
