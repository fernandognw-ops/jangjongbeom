-- =============================================================================
-- ⚠️ 임시 복구용 — 정확한 판매채널이 아님
-- =============================================================================
-- 배경: sales_channel이 NULL인 행은 엑셀 「판매 채널」이 반영되지 않은 적재이거나,
--       컬럼 추가 이전 데이터일 수 있음.
-- 원칙적으로는 inventory_stock_snapshot 비우고 동일 엑셀을 웹에서 재업로드하는 것이 가장 정확함.
--
-- 아래는 dest_warehouse(과거에 쿠팡/일반만 넣었던 경우)를 기준으로 NULL만 채우는 레거시 추론이다.
-- 물리 창고명만 dest에 있는 행은 대부분 '일반'으로 잘못 들어갈 수 있음.
-- =============================================================================

-- 사전 확인
-- SELECT COUNT(*) FROM inventory_stock_snapshot WHERE sales_channel IS NULL;

UPDATE inventory_stock_snapshot
SET sales_channel = CASE
  WHEN trim(COALESCE(dest_warehouse, '')) IN ('쿠팡')
    OR lower(trim(COALESCE(dest_warehouse, ''))) = 'coupang'
    OR trim(COALESCE(dest_warehouse, '')) LIKE '%테이칼튼%'
  THEN '쿠팡'
  ELSE '일반'
END
WHERE sales_channel IS NULL;

-- (선택) NOT NULL + 기본값
-- ALTER TABLE inventory_stock_snapshot ALTER COLUMN sales_channel SET DEFAULT '일반';
-- UPDATE inventory_stock_snapshot SET sales_channel = '일반' WHERE sales_channel IS NULL;
