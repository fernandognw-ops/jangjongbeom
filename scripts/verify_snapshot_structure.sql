-- inventory_stock_snapshot 구조 검증
-- (product_code, dest_warehouse, snapshot_date) 기준 다중 row 존재 확인

-- 1) snapshot_date별 건수
SELECT snapshot_date, COUNT(*) AS row_count
FROM inventory_stock_snapshot
GROUP BY snapshot_date
ORDER BY snapshot_date DESC
LIMIT 20;

-- 2) dest_warehouse 분포 (최신 snapshot_date 기준)
WITH latest AS (
  SELECT MAX(snapshot_date) AS max_date FROM inventory_stock_snapshot
)
SELECT dest_warehouse, COUNT(*) AS cnt, SUM(quantity) AS total_qty
FROM inventory_stock_snapshot s, latest l
WHERE s.snapshot_date = l.max_date
GROUP BY dest_warehouse;

-- 3) 동일 product_code가 날짜별 여러 행 있는지 (정상)
SELECT product_code, COUNT(DISTINCT snapshot_date) AS date_count
FROM inventory_stock_snapshot
GROUP BY product_code
HAVING COUNT(DISTINCT snapshot_date) > 1
LIMIT 10;
