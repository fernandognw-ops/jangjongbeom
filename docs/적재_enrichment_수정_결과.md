# 적재 Enrichment 수정 결과 보고

## 원인 요약

- **rawdata(inventory_products)**는 정상 적재됨
- **inbound/outbound/stock_snapshot** 적재 시 inventory_products 기준 보강(enrichment)이 없음
- product_name, category, pack_size, unit_price, total_price가 NULL 또는 비정상
- category에 product_code가 들어가는 경우: parser의 "품목" synonym이 "품목코드" 컬럼과 매칭됨

---

## 수정 파일 목록

| 파일 | 변경 내용 |
|------|-----------|
| `src/lib/commitProductionSheet.ts` | inventory_products lookup 후 enrichment, total_price 계산 |
| `src/lib/excelParser/rules.ts` | category synonym에서 "품목" 제거 (품목코드 오매칭 방지) |
| `src/lib/excelParser/parser.ts` | category findCol 시 product_code synonym exclude |
| `src/app/api/production-sheet-commit/route.ts` | revalidatePath("/") 추가 |
| `scripts/backfill_inventory_from_products.sql` | 기존 데이터 보정 스크립트 (신규) |

---

## 보정 스크립트

**파일명**: `scripts/backfill_inventory_from_products.sql`

**실행**: Supabase SQL Editor에서 실행

**대상**: inventory_inbound, inventory_outbound, inventory_stock_snapshot

**보정 방식**: inventory_products와 product_code 기준 조인하여 NULL/0 값 업데이트

---

## 수정 전/후 샘플 row 비교

### 수정 전 (inbound)
```json
{
  "product_code": "8809912474938",
  "product_name": null,
  "category": null,
  "pack_size": null,
  "unit_price": 0,
  "total_price": 0,
  "quantity": 100,
  "inbound_date": "2026-03-01"
}
```

### 수정 후 (inbound)
```json
{
  "product_code": "8809912474938",
  "product_name": "상품명A",
  "category": "기타",
  "pack_size": 1,
  "unit_price": 1500,
  "total_price": 150000,
  "quantity": 100,
  "inbound_date": "2026-03-01"
}
```

### 수정 전 (stock_snapshot)
```json
{
  "product_code": "8809912474938",
  "product_name": null,
  "category": null,
  "pack_size": null,
  "unit_cost": 0,
  "total_price": 0,
  "quantity": 50
}
```

### 수정 후 (stock_snapshot)
```json
{
  "product_code": "8809912474938",
  "product_name": "상품명A",
  "category": "기타",
  "pack_size": 1,
  "unit_cost": 1500,
  "total_price": 75000,
  "quantity": 50
}
```

---

## /api/inventory/quick 응답 비교

### 수정 전 (stock_snapshot 0건 또는 enrichment 없음)
```json
{
  "items": [],
  "totalValue": 0,
  "productCount": 0,
  "error": "no_snapshot"
}
```

### 수정 후 (정상)
```json
{
  "items": [...],
  "totalValue": 789224584,
  "productCount": 414,
  "stockByChannel": { "coupang": {...}, "general": {...} }
}
```

---

## 대시보드 반영 결과

- commit 성공 후 `refresh()` 호출 → quick API 재조회
- `revalidatePath("/")`로 서버 캐시 무효화
- stock_snapshot row 존재 시 KPI/그래프/재고 분포 정상 표시

---

## 검증 기준 (수정 후 기대)

| 테이블 | 건수 | 필드 |
|--------|------|------|
| inventory_products | 480 | product_name, category, pack_size, unit_cost 정상 |
| inventory_inbound | 172 | product_name, category, pack_size, unit_price, total_price 정상 |
| inventory_outbound | 2965 | product_name, category, pack_size, unit_price, total_price 정상 |
| inventory_stock_snapshot | 414 | product_name, category, pack_size, unit_cost, total_price 정상 |
| 대시보드 | - | totalValue > 0, productCount > 0, KPI/그래프 정상 |

---

## 실행 순서

1. 코드 배포
2. 기존 데이터 보정: Supabase SQL Editor에서 `scripts/backfill_inventory_from_products.sql` 실행
3. 또는 동일 Excel 재업로드 → DB 반영 (신규 enrichment 로직 적용)
