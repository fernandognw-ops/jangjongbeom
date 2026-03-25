-- 업로드 idempotency: source_row_key 중복 없음 (마이그레이션 scripts/alter_inventory_add_source_row_key.sql 적용 후)

SELECT 'inbound_dup_keys' AS check_name, COUNT(*) - COUNT(DISTINCT source_row_key) AS extra_rows
FROM inventory_inbound WHERE source_row_key IS NOT NULL
UNION ALL
SELECT 'outbound_dup_keys', COUNT(*) - COUNT(DISTINCT source_row_key)
FROM inventory_outbound WHERE source_row_key IS NOT NULL
UNION ALL
SELECT 'snapshot_dup_keys', COUNT(*) - COUNT(DISTINCT source_row_key)
FROM inventory_stock_snapshot WHERE source_row_key IS NOT NULL;

-- 월×채널 출고 수량 — API category-trend 월별 출고 합과 대조 (원본 전량 group by)
SELECT
  to_char(outbound_date, 'YYYY-MM') AS ym,
  CAST(sales_channel AS TEXT) AS sales_channel,
  SUM(quantity) AS qty_sum,
  COUNT(*) AS row_cnt
FROM inventory_outbound
GROUP BY 1, 2
ORDER BY 1, 2;
