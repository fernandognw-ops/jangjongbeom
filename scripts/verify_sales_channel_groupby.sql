-- 판매채널(sales_channel) 기준 행 수 검증 — 입고·출고·재고 스냅샷
-- 재고 테이블명: inventory_stock_snapshot (앱 집계와 동일)

SELECT CAST(sales_channel AS TEXT) AS sales_channel, COUNT(*) FROM inventory_inbound GROUP BY 1 ORDER BY 1;
SELECT CAST(sales_channel AS TEXT) AS sales_channel, COUNT(*) FROM inventory_outbound GROUP BY 1 ORDER BY 1;
SELECT CAST(sales_channel AS TEXT) AS sales_channel, COUNT(*) FROM inventory_stock_snapshot GROUP BY 1 ORDER BY 1;
