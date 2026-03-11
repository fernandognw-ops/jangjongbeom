-- ============================================================
-- inventory_stock_snapshot: product_code 단일 PK로 원상복구
-- (product_code, dest_warehouse) 복합키 제거
-- Supabase SQL Editor에서 실행하세요.
-- ============================================================

-- 1. 기존 PK 제거
ALTER TABLE inventory_stock_snapshot DROP CONSTRAINT IF EXISTS inventory_stock_snapshot_pkey;

-- 2. product_code별 quantity 합산 후 1건으로 통합
WITH merged AS (
  SELECT
    product_code,
    SUM(quantity)::INTEGER AS quantity,
    MAX(unit_cost) AS unit_cost,
    MAX(snapshot_date) AS snapshot_date,
    MAX(COALESCE(pack_size, 1)) AS pack_size,
    SUM(COALESCE(total_price, 0)) AS total_price
  FROM inventory_stock_snapshot
  GROUP BY product_code
),
del AS (DELETE FROM inventory_stock_snapshot)
INSERT INTO inventory_stock_snapshot (product_code, quantity, unit_cost, snapshot_date, pack_size, total_price)
SELECT product_code, quantity, unit_cost, snapshot_date, pack_size, total_price FROM merged;

-- 3. product_code 단일 PK 적용
ALTER TABLE inventory_stock_snapshot ADD CONSTRAINT inventory_stock_snapshot_pkey PRIMARY KEY (product_code);

SELECT 'inventory_stock_snapshot product_code 단일 PK 원상복구 완료' AS status;
