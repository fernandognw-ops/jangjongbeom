# Schema All-in-One

입고·출고·재고 테이블이 외부 참조 없이 자체적으로 모든 정보를 보유하는 구조.

## 공통 컬럼 (세 테이블 공통)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| product_code | TEXT | 상품코드(바코드) |
| product_name | TEXT | 상품명 |
| category | TEXT | 품목구분 |
| spec | TEXT | 규격 |
| pack_size | INTEGER | 입수량 (박스당 개수) |
| unit_price | NUMERIC(12,2) | 단가 |
| total_price | NUMERIC(14,2) | 총 금액 |

## 테이블별 구조

### inventory_stock_snapshot
- product_code (PK), (product_code, dest_warehouse) 복합 PK 지원
- quantity, unit_cost, snapshot_date, pack_size, total_price, updated_at
- **dest_warehouse = 창고명** (동일 개념): 테이칼튼/테이칼튼1공장→쿠팡, 제이에스/컬리→일반
- **추가**: product_name, category, spec, unit_price

### inventory_inbound
- id (PK), product_code, quantity, inbound_date, source_warehouse, dest_warehouse(=입고처), note, created_at
- **dest_warehouse(입고처)**: 테이칼튼/테이칼튼 1공장→쿠팡, 제이에스→일반
- **추가**: product_name, category, spec, pack_size, unit_price, total_price

### inventory_outbound
- id (PK), product_code, quantity, sales_channel, outbound_date, source_warehouse, dest_warehouse, note, created_at
- **추가**: product_name, category, spec, pack_size, unit_price, total_price

## 마이그레이션

```bash
# Supabase SQL Editor에서 실행
scripts/add_all_in_one_columns.sql
```
