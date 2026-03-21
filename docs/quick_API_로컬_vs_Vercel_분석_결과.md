# /api/inventory/quick 로컬 vs Vercel 차이 원인 분석 결과

## 요약

**결론**: 같은 DB(slnmhblsxzjgmaqbfbwa)를 보고 있으며, **Vercel API 로직이 잘못된 것이 아니라** `inventory_stock_snapshot` 테이블의 실제 row 수가 환경에 따라 다르게 보이는 상황입니다.  
추가로, **RLS(Row Level Security) 또는 쿼리 구조에 따른 차이** 가능성이 확인되었습니다.

---

## 1. 쿼리 상세 로그 (debug=1)

### 조회 대상 테이블
- `inventory_stock_snapshot`

### 쿼리 1 (maxDate 조회)
- **조건**: `select snapshot_date` + `order by snapshot_date desc` + `limit 1`
- **목적**: 최신 snapshot_date 1건 조회

### 쿼리 2 (해당 일자 데이터)
- **조건**: `select product_code, product_name, quantity, pack_size, total_price, unit_cost, dest_warehouse, category, snapshot_date` + `eq snapshot_date {maxDate}`
- **목적**: maxDate와 일치하는 행 전체 조회

### 0건 반환 분기
1. `!url || !key` → `supabase_not_configured`
2. `maxErr || !maxDateRes?.length` → `no_snapshot` ← **Vercel이 이 분기로 진입**
3. `!maxDate` → `invalid_date`
4. `error` (쿼리2) → `error.message`
5. `catch` → 예외 메시지

---

## 2. 로컬 vs Vercel 응답 비교

| 항목 | localhost | Vercel |
|------|-----------|--------|
| productCount | 326 (데이터 있을 때) / 0 (없을 때) | 0 |
| totalValue | 789,412,321 (있을 때) / 0 | 0 |
| items.length | 326 / 0 | 0 |
| _supabase_project_ref | slnmhblsxzjgmaqbfbwa | slnmhblsxzjgmaqbfbwa |
| error | (없음) / no_snapshot | no_snapshot |

### inventory-diag 비교 (동일 프로젝트)

| 테이블 | localhost (이전) | localhost (현재) | Vercel |
|--------|-----------------|------------------|--------|
| inventory_stock_snapshot | 326 | 0 | 0 |
| inventory_inbound | 157 | 157 | 0 |
| inventory_outbound | 2597 | 2597 | 0 |

---

## 3. route.ts 내부 분기 검토

- **환경별 분기**: 없음 (`NODE_ENV`, `VERCEL` 등으로 분기하는 코드 없음)
- **hostname/request 기준 분기**: 없음
- **empty_data fallback**: `maxErr || !maxDateRes?.length` 시 `no_snapshot`으로 0건 반환 (정상 분기)

---

## 4. Vercel에서 에러 숨김 여부

- **try/catch**: 있음. 예외 시 `error` 필드에 메시지 포함, `items: []` 반환
- **에러 은폐**: 없음. `maxErr?.message`, `error.message`를 그대로 노출
- **0건 반환**: 쿼리 1이 빈 배열을 반환할 때 `no_snapshot`으로 0건 반환 (의도된 동작)

---

## 5. 테이블 row count 검증

`/api/inventory-diag`로 확인한 결과:

- **로컬**: `inventory_stock_snapshot` 326 → 0으로 변경됨 (시점에 따라 상이)
- **Vercel**: `inventory_stock_snapshot` 0, `inventory_inbound` 0, `inventory_outbound` 0

동일 project ref에서 로컬만 326건을 본 시점이 있었고, 이후 로컬도 0건으로 일치하는 경우가 확인됨.

---

## 6. RLS/쿼리 구조 관련 발견 (로컬 326건 시점)

로컬에서 `inventory_stock_snapshot` 326건이 보일 때 다음 실험이 수행됨:

| 쿼리 | 결과 |
|------|------|
| `select("product_code,quantity,category,snapshot_date")` (limit 없음) | 326건 |
| `select("snapshot_date").order().limit(1)` | 0건 |
| `select("snapshot_date").limit(1)` | 0건 |
| `select("snapshot_date")` (limit 없음) | 0건 |
| `select("*", { count: "exact", head: true })` | 0 |
| `select("product_code,snapshot_date").order().limit(1)` | 0건 |

→ **RLS 정책이 선택 컬럼/limit/order 등에 따라 다르게 적용되는 가능성**이 있음.

---

## 7. 최종 결론

1. **같은 DB를 보고 있음**  
   - 로컬·Vercel 모두 `slnmhblsxzjgmaqbfbwa` 사용
   - 환경변수 불일치는 아님

2. **Vercel API 로직 문제 아님**  
   - `no_snapshot`은 쿼리 1이 빈 배열을 반환할 때의 정상 분기
   - 에러를 숨기지 않고 그대로 반환

3. **가능한 원인**
   - **RLS**: `inventory_stock_snapshot`에 컬럼/쿼리 형태별로 다른 정책이 적용될 수 있음
   - **데이터 시점 차이**: 로컬·Vercel에서 보는 데이터가 시점에 따라 달라질 수 있음
   - **Supabase 연결 차이**: 지역/풀러 등으로 인한 연결 차이 가능성 (추가 확인 필요)

4. **권장 조치**
   - Supabase 대시보드에서 `inventory_stock_snapshot` RLS 정책 확인
   - `anon` 역할에 대한 SELECT 정책이 `order`/`limit`/`eq` 사용 시에도 동일하게 적용되는지 검토
   - 필요 시 `select("product_code,quantity,category,snapshot_date")`처럼 동작하는 쿼리로 maxDate를 계산하는 우회 로직 검토

---

## 디버그 사용법

```
GET /api/inventory/quick?debug=1
```

응답에 `_debug` 필드가 포함되어, 쿼리 1/2 결과와 분기 정보를 확인할 수 있습니다.
