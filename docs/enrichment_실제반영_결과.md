# enrichment 실제 반영 결과 보고

## 배포 커밋 / 배포 상태

| 항목 | 결과 |
|------|------|
| **커밋** | 7148a0f - feat: inventory_products 기준 enrichment 적용 |
| **푸시** | main → origin/main |
| **Vercel 배포** | Ready (jangjongbeom-y03syk7hq, 52s) |

---

## backfill 실행 여부

| 항목 | 상태 |
|------|------|
| **실행** | ☐ 완료 (사용자 수동 실행 필요) |
| **방법** | Supabase SQL Editor → `scripts/backfill_inventory_from_products.sql` 붙여넣기 → Run |

---

## 수정 전/후 샘플 row 비교

### inventory_inbound (수정 전)
```json
{"product_code":"8809912473146","product_name":null,"category":"캡슐세제","pack_size":1,"unit_price":0,"total_price":0,"quantity":576000}
{"product_code":"8809635659025","product_name":null,"category":"마스크","pack_size":1,"unit_price":0,"total_price":0,"quantity":40650}
```

### inventory_outbound (수정 전 - category에 product_code 오류)
```json
{"product_code":"8809912473122","product_name":null,"category":"8809912473122","pack_size":1,"unit_price":0,"total_price":0,"quantity":3832}
{"product_code":"8809912473207","product_name":null,"category":"8809912473207","pack_size":1,"unit_price":0,"total_price":0,"quantity":89}
```

### inventory_stock_snapshot (수정 전)
```json
{"product_code":"8809912474518","product_name":null,"category":null,"pack_size":1,"unit_cost":3100,"total_price":3720000,"quantity":1200}
{"product_code":"8809912473207","product_name":null,"category":null,"pack_size":1,"unit_cost":2200,"total_price":4276800,"quantity":1944}
```

### 수정 후 (backfill 실행 후 기대)
- product_name: inventory_products.product_name
- category: inventory_products.category (outbound의 product_code 오류 수정)
- unit_price/unit_cost: inventory_products.unit_cost
- total_price: quantity × unit_price

---

## /api/inventory/quick 결과

| 항목 | 값 |
|------|-----|
| totalValue | 731,930,430 |
| productCount | 328 |
| error | (없음) |
| totalQuantity | 9,969,055 |

※ quick API는 productFallback으로 stock_snapshot의 null product_name/category를 inventory_products에서 보강하여 반환. 따라서 backfill 전에도 대시보드는 정상 표시됨.

---

## 대시보드 반영 결과

| 항목 | 상태 |
|------|------|
| KPI | totalValue > 0, productCount > 0 |
| 그래프 | 정상 (quick API 데이터 사용) |
| 재고 분포 | channelTotals(판매채널): 일반 3,878,897 / 쿠팡 6,090,158 |

---

## 다음 단계

1. Supabase SQL Editor에서 `scripts/backfill_inventory_from_products.sql` 실행
2. `node scripts/verify_enrichment.mjs`로 샘플 row 재확인
