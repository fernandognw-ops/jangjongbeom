-- ============================================================
-- 첫 업로드 후 검증 SQL
-- Supabase SQL Editor에서 실행
-- ============================================================

-- 1) 테이블별 row 수
SELECT 'inventory_products' AS tbl, COUNT(*) AS cnt FROM inventory_products
UNION ALL SELECT 'inventory_inbound', COUNT(*) FROM inventory_inbound
UNION ALL SELECT 'inventory_outbound', COUNT(*) FROM inventory_outbound
UNION ALL SELECT 'inventory_stock_snapshot', COUNT(*) FROM inventory_stock_snapshot
UNION ALL SELECT 'inventory_upload_logs', COUNT(*) FROM inventory_upload_logs;

-- 2) stock_snapshot 중복 여부 (PK: product_code, dest_warehouse, snapshot_date)
-- 중복 있으면 0보다 큼
SELECT COUNT(*) AS duplicate_count FROM (
  SELECT product_code, dest_warehouse, snapshot_date, COUNT(*) AS n
  FROM inventory_stock_snapshot
  GROUP BY product_code, dest_warehouse, snapshot_date
  HAVING COUNT(*) > 1
) t;

-- 3) 일반/쿠팡 분포
SELECT dest_warehouse, COUNT(*) AS row_cnt, SUM(quantity) AS total_qty, SUM(total_price) AS total_value
FROM inventory_stock_snapshot
GROUP BY dest_warehouse;

-- 4) 총 재고 금액
SELECT SUM(total_price) AS total_stock_value FROM inventory_stock_snapshot;

-- 5) 최신 snapshot_date
SELECT snapshot_date, COUNT(*) AS row_cnt
FROM inventory_stock_snapshot
GROUP BY snapshot_date
ORDER BY snapshot_date DESC
LIMIT 5;
