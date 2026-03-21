-- inventory_stock_snapshot: 판매채널 컬럼 추가 + PK 확장
-- Supabase SQL Editor에서 실행. (백업 권장)
--
-- 기존: dest_warehouse에 쿠팡/일반(채널)이 들어가 있던 데이터 → sales_channel으로 이관 후
--       dest_warehouse는 물리 창고만 (채널 전용 값은 빈 문자열로 정리)

-- 1) 컬럼 추가
ALTER TABLE inventory_stock_snapshot ADD COLUMN IF NOT EXISTS sales_channel TEXT;

-- 2) 레거시: dest_warehouse에 있던 채널 의미 → sales_channel
UPDATE inventory_stock_snapshot
SET sales_channel = CASE
  WHEN trim(COALESCE(dest_warehouse, '')) IN ('쿠팡')
    OR lower(trim(COALESCE(dest_warehouse, ''))) = 'coupang'
    OR trim(COALESCE(dest_warehouse, '')) LIKE '%테이칼튼%'
  THEN '쿠팡'
  ELSE '일반'
END
WHERE sales_channel IS NULL OR trim(COALESCE(sales_channel, '')) = '';

UPDATE inventory_stock_snapshot SET sales_channel = '일반' WHERE sales_channel IS NULL OR trim(sales_channel) = '';

-- 3) 채널만 저장되던 dest_warehouse 비우기 (물리 창고는 이후 엑셀 재적재로 채움)
UPDATE inventory_stock_snapshot
SET dest_warehouse = ''
WHERE trim(COALESCE(dest_warehouse, '')) IN ('쿠팡', '일반')
   OR lower(trim(COALESCE(dest_warehouse, ''))) = 'coupang';

-- 4) NOT NULL
ALTER TABLE inventory_stock_snapshot ALTER COLUMN sales_channel SET DEFAULT '일반';
ALTER TABLE inventory_stock_snapshot ALTER COLUMN sales_channel SET NOT NULL;

-- 5) PK 재생성 (product_code, dest_warehouse, sales_channel, snapshot_date)
ALTER TABLE inventory_stock_snapshot DROP CONSTRAINT IF EXISTS inventory_stock_snapshot_pkey;

ALTER TABLE inventory_stock_snapshot
  ADD PRIMARY KEY (product_code, dest_warehouse, sales_channel, snapshot_date);

-- dest_warehouse 빈 문자열 허용 (동일 품목·날짜에 쿠팡/일반 행 구분용)
