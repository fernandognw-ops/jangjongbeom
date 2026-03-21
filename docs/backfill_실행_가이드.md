# Backfill 실행 가이드

## 목표
화면 fallback이 아니라 **DB 자체 값**을 `inventory_products` 기준으로 정상화

---

## 1. Backfill SQL 실행

### 방법 A: Supabase SQL Editor (권장)
1. [Supabase Dashboard](https://supabase.com/dashboard) → 프로젝트 선택
2. **SQL Editor** 메뉴
3. `scripts/backfill_inventory_from_products.sql` 내용 전체 복사 후 붙여넣기
4. **Run** 실행

### 방법 B: 로컬에서 pg로 실행
`.env.local`에 `DATABASE_URL` 또는 `SUPABASE_DB_URL` 설정 후:
```bash
node scripts/run_backfill.mjs
```

---

## 2. 실행 후 샘플 확인

```bash
node scripts/verify_enrichment.mjs
```

### 확인 항목
| 항목 | inbound/outbound | stock_snapshot |
|------|------------------|----------------|
| product_name | ✓ | ✓ |
| category | ✓ | ✓ |
| pack_size | ✓ | ✓ |
| unit_price / unit_cost | ✓ | ✓ |
| total_price | ✓ | ✓ |

---

## 3. 수정 전/후 비교

### 수정 전 (대화 요약 기준)
| 테이블 | product_name | category | unit_price/cost | total_price |
|--------|--------------|----------|-----------------|-------------|
| inventory_inbound | null | "캡슐세제", "마스크" (엑셀) | 0 | 0 |
| inventory_outbound | null | "8809912473122" (product_code 오입력) | 0 | 0 |
| inventory_stock_snapshot | null | null | 일부 존재 | 일부 존재 |

### 수정 후 (verify_enrichment.mjs 실행 결과)

**inventory_inbound**
```json
{"product_code":"8809912474259","product_name":"허글리 데일리핏 마스크(데일리) 대형 화이트 50매","category":"마스크","pack_size":50,"unit_price":40,"total_price":1440000,"quantity":36000}
{"product_code":"8809912473511","product_name":"클라 듀얼 울트라 클린 캡슐세제_프리지아 100개입","category":"캡슐세제","pack_size":100,"unit_price":41,"total_price":3936000,"quantity":96000}
```

**inventory_outbound**
```json
{"product_code":"8809912473122","product_name":"클라 퍼퓸 캡슐세제 샘플 4매입 클린솝","category":"생활용품","pack_size":4,"unit_price":90,"total_price":344880,"quantity":3832}
{"product_code":"8809912473207","product_name":"섬유유연제 플라워가든","category":"섬유유연제","pack_size":1,"unit_price":2200,"total_price":195800,"quantity":89}
```

**inventory_stock_snapshot**
```json
{"product_code":"8809912474518","product_name":"허글리 초고농축 섬유유연제 미스틱퍼퓸 3L / 1개","category":"섬유유연제","pack_size":1,"unit_cost":3100,"total_price":3720000,"quantity":1200}
{"product_code":"8809912473207","product_name":"섬유유연제 플라워가든","category":"섬유유연제","pack_size":1,"unit_cost":2200,"total_price":4276800,"quantity":1944}
```

**quick API**
- totalValue: 731930430
- productCount: 328
- error: (없음)

---

## 4. Backfill SQL 변경 사항 (이번 수정)

- **조건 완화**: `AND (product_name IS NULL OR ...)` 제거 → **product_code로 조인되는 모든 row** 보정
- **category 정규화**: `i.category` 대신 **`p.category` / `p.group_name`** 사용 → product_code가 category에 들어간 오류 수정
- **전체 일괄 보정**: NULL/0만이 아니라, inventory_products 기준으로 통일

---

## 5. 정리

| 항목 | 수정 전 | 수정 후 |
|------|---------|---------|
| product_name | null | inventory_products 기준 채움 |
| category | null / product_code 오입력 | p.category 또는 p.group_name |
| pack_size | 0 또는 null | p.pack_size |
| unit_price/unit_cost | 0 | p.unit_cost |
| total_price | 0 또는 부정확 | quantity × unit_price/cost |

**현재 DB 상태**: verify_enrichment.mjs 결과 상 이미 정상화된 것으로 보임.  
이전 backfill 또는 enrichment 로직 적용으로 처리된 것으로 추정.  
추가로 **미처리 row**가 있다면 `backfill_inventory_from_products.sql` 실행으로 일괄 보정 가능.
