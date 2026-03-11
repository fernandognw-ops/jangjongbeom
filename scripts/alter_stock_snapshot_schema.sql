-- inventory_stock_snapshot: 창고명, 매출구분 추가 (선택)
-- unit_cost는 유지하되 0으로 두고, 원가는 inventory_products에서 사용

ALTER TABLE inventory_stock_snapshot ADD COLUMN IF NOT EXISTS warehouse_name TEXT DEFAULT '';
ALTER TABLE inventory_stock_snapshot ADD COLUMN IF NOT EXISTS sales_channel TEXT DEFAULT 'general';
