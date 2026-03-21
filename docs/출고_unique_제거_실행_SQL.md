# inventory_outbound unique 제약 제거 - 실행 SQL

## 제거 대상 (병합용)

| 항목 | 유형 | 기준 |
|------|------|------|
| idx_outbound_upsert | constraint/index | product_code + outbound_date + dest_warehouse |
| inventory_outbound_product_code_outbound_date_key | constraint | product_code + outbound_date |
| inventory_outbound_product_code_outbound_date_sales_channel_key | constraint/index | product_code + outbound_date + sales_channel |
| inventory_outbound_product_code_outbound_date_dest_warehouse_key | constraint/index | product_code + outbound_date + dest_warehouse |
| unique_outbound_record | index | - |

## 유지 (조회용)

| 인덱스 | 컬럼 |
|--------|------|
| idx_inv_outbound_date | outbound_date DESC |
| idx_inv_outbound_product | product_code |
| idx_inv_outbound_channel | sales_channel |
| idx_inv_outbound_warehouse | dest_warehouse |

---

## 실행 SQL (Supabase SQL Editor)

```sql
-- scripts/migrate_outbound_no_merge.sql

-- 1. unique constraint 제거
ALTER TABLE inventory_outbound DROP CONSTRAINT IF EXISTS idx_outbound_upsert;
ALTER TABLE inventory_outbound DROP CONSTRAINT IF EXISTS inventory_outbound_product_code_outbound_date_key;
ALTER TABLE inventory_outbound DROP CONSTRAINT IF EXISTS inventory_outbound_product_code_outbound_date_sales_channel_key;
ALTER TABLE inventory_outbound DROP CONSTRAINT IF EXISTS inventory_outbound_product_code_outbound_date_dest_warehouse_key;

-- 2. unique index 제거 (CREATE UNIQUE INDEX로 생성된 것)
DROP INDEX IF EXISTS idx_outbound_upsert;
DROP INDEX IF EXISTS inventory_outbound_product_code_outbound_date_sales_channel_key;
DROP INDEX IF EXISTS inventory_outbound_product_code_outbound_date_dest_warehouse_key;
DROP INDEX IF EXISTS unique_outbound_record;

-- 3. 조회용 인덱스만 유지
CREATE INDEX IF NOT EXISTS idx_inv_outbound_date ON inventory_outbound(outbound_date DESC);
CREATE INDEX IF NOT EXISTS idx_inv_outbound_product ON inventory_outbound(product_code);
CREATE INDEX IF NOT EXISTS idx_inv_outbound_channel ON inventory_outbound(sales_channel);
CREATE INDEX IF NOT EXISTS idx_inv_outbound_warehouse ON inventory_outbound(dest_warehouse);

SELECT '출고 unique 제약 제거 완료. 1 row = 1 트랜잭션.' AS status;
```

---

## 실행 후 확인

동일 Excel 재업로드 → DB 반영 → outbound 2965건 저장 확인
