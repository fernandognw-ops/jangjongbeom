-- inventory_stock_snapshot 점검 (Supabase SQL Editor)
-- sales_channel NULL / dest_warehouse / snapshot_date 분포

-- 1) 전체 건수
SELECT COUNT(*) AS total_rows FROM inventory_stock_snapshot;

-- 2) sales_channel IS NULL 건수
SELECT COUNT(*) AS null_sales_channel_rows
FROM inventory_stock_snapshot
WHERE sales_channel IS NULL;

-- 3) sales_channel 값별 건수
SELECT COALESCE(sales_channel, '(NULL)') AS sales_channel, COUNT(*) AS cnt
FROM inventory_stock_snapshot
GROUP BY sales_channel
ORDER BY cnt DESC;

-- 4) dest_warehouse 분포 (상위 30)
SELECT COALESCE(NULLIF(TRIM(dest_warehouse), ''), '(빈문자)') AS dest_warehouse, COUNT(*) AS cnt, SUM(quantity) AS sum_qty
FROM inventory_stock_snapshot
GROUP BY 1
ORDER BY cnt DESC
LIMIT 30;

-- 5) snapshot_date 분포
SELECT snapshot_date::text, COUNT(*) AS cnt, SUM(quantity) AS sum_qty
FROM inventory_stock_snapshot
GROUP BY snapshot_date
ORDER BY snapshot_date DESC;
