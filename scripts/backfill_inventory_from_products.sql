-- ============================================================
-- 기존 적재 데이터 보정: inventory_products 기준 enrichment
-- Supabase SQL Editor에서 실행
-- ============================================================
--
-- 대상: inventory_inbound, inventory_outbound, inventory_stock_snapshot
-- 보정: product_name, category, pack_size, unit_price/unit_cost, total_price
--
-- ============================================================

-- 1. inventory_inbound 보정 (inventory_products 기준, product_code-in-category 등 오류 포함)
UPDATE inventory_inbound i
SET
  product_name = COALESCE(NULLIF(TRIM(i.product_name), ''), p.product_name, i.product_code),
  category = COALESCE(NULLIF(TRIM(p.category), ''), p.group_name, '기타'),
  pack_size = CASE WHEN COALESCE(i.pack_size, 0) <= 0 THEN COALESCE(p.pack_size, 1) ELSE i.pack_size END,
  unit_price = CASE WHEN COALESCE(i.unit_price, 0) <= 0 THEN COALESCE(p.unit_cost, 0) ELSE i.unit_price END,
  total_price = (i.quantity * COALESCE(NULLIF(i.unit_price, 0), p.unit_cost, 0))
FROM inventory_products p
WHERE i.product_code = p.product_code;

-- 2. inventory_outbound 보정 (category에 product_code 들어간 오류 포함)
UPDATE inventory_outbound o
SET
  product_name = COALESCE(NULLIF(TRIM(o.product_name), ''), p.product_name, o.product_code),
  category = COALESCE(NULLIF(TRIM(p.category), ''), p.group_name, '기타'),
  pack_size = CASE WHEN COALESCE(o.pack_size, 0) <= 0 THEN COALESCE(p.pack_size, 1) ELSE o.pack_size END,
  unit_price = CASE WHEN COALESCE(o.unit_price, 0) <= 0 THEN COALESCE(p.unit_cost, 0) ELSE o.unit_price END,
  total_price = (o.quantity * COALESCE(NULLIF(o.unit_price, 0), p.unit_cost, 0))
FROM inventory_products p
WHERE o.product_code = p.product_code;

-- 3. inventory_stock_snapshot 보정
UPDATE inventory_stock_snapshot s
SET
  product_name = COALESCE(NULLIF(TRIM(s.product_name), ''), p.product_name, s.product_code),
  category = COALESCE(NULLIF(TRIM(p.category), ''), p.group_name, '기타'),
  pack_size = CASE WHEN COALESCE(s.pack_size, 0) <= 0 THEN COALESCE(p.pack_size, 1) ELSE s.pack_size END,
  unit_cost = CASE WHEN COALESCE(s.unit_cost, 0) <= 0 THEN COALESCE(p.unit_cost, 0) ELSE s.unit_cost END,
  total_price = (s.quantity * COALESCE(NULLIF(s.unit_cost, 0), p.unit_cost, 0)),
  updated_at = NOW()
FROM inventory_products p
WHERE s.product_code = p.product_code;

SELECT 'backfill 완료' AS status;
