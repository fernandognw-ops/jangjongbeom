# 대시보드 재고 KPI·판매채널 집계 정리

## 1. 상단/하단 데이터 소스 비교표

| UI 영역 | 데이터 소스 | API | 주요 필드·집계 |
|--------|-------------|-----|----------------|
| **총 재고 금액** (page 상단 KPI) | `kpiData.totalValue` | `GET /api/inventory/quick` | 최신 `snapshot_date` 1일, `inventory_stock_snapshot` 행별 `total_price` 합(제품 단위 merge 후 합산과 동일 정책). `total_price≤0`이면 `quantity×unit_cost` |
| **총 재고 수량 (EA)** | `kpiData.totalQuantity` | 동일 | 동일 날짜, 제품코드 기준 merge 후 `quantity` 합 |
| **품목 수** | `kpiData.productCount` | 동일 | `product_code` **고유 개수** (동일 품목이 쿠팡·일반 **두 채널**이면 **1품목**으로 집계) |
| **SKU(박스)** | `kpiData.totalSku` | 동일 | 품목별 `floor(quantity / pack_size)` 합 |
| **상단 쿠팡/일반 요약** (DashboardBoxHero) | `channelTotals` | `quick` → `channelTotals` | DB `dest_warehouse`를 **판매채널**로 해석 → **`normalizeDestWarehouse`** → 키 `"쿠팡"` \| `"일반"` 만 사용, 수량 합 |
| **하단 채널별 재고** | 동일 `channelTotals` | 동일 | 위와 **동일 객체**를 `Object.entries`로 표시 (구 API 필드명 `stockByWarehouse`는 동일 값 호환용) |

## 2. DB·정의와 숫자 차이 (328 vs 414 등)

| 구분 | 의미 |
|------|------|
| **원본 행 수 (예: 414)** | `inventory_stock_snapshot`에서 **최신 `snapshot_date` 1일**의 **행 수** = `product_code × dest_warehouse`(및 기타 PK 조합) 조합 수 |
| **품목 수 (예: 328)** | 동일 스냅샷에서 **`product_code` DISTINCT** 수. 한 품목이 일반·쿠팡 **두 채널**에 있으면 행은 2·품목은 1 |
| **총 재고 수량** | **모든 행**의 `quantity` 합 = 채널별 수량 합 = `channelTotals["쿠팡"] + channelTotals["일반"]` |

## 3. 잘못되었던 집계 기준 (과거)

| 문제 | 내용 |
|------|------|
| 상단 쿠팡/일반 라인 | `isCoupangWarehouse`가 **문자열 `"테이칼튼"` 포함 여부만** 쿠팡으로 처리. API는 `dest_warehouse`를 **`"쿠팡"`으로 정규화**해 집계하므로, 상단은 **`"쿠팡"` 키를 쿠팡으로 인식하지 못해 쿠팡 0·일반으로 몰림** |
| 하단 라벨 | 같은 `channelTotals`를 쓰지만, 배지가 **테이칼튼만** 쿠팡으로 처리해 **`쿠팡` 문자열이 일반으로 표시**될 수 있었음 |

## 4. 정책 (통일 후)

- **`inventory_stock_snapshot.dest_warehouse`**: 물리 창고명이 아니라 **판매채널** 저장(또는 동기화 시 센터명 등을 채널로 정규화).
- 재고 KPI·채널 요약: **`inventory_stock_snapshot` 최신 `snapshot_date` 1개**만 사용.
- 쿠팡/일반: **`dest_warehouse`만** 사용 (`sales_channel` 아님), **`normalizeDestWarehouse`** 단일 구현 (`@/lib/inventoryChannels`).
- 상단 쿠팡/일반 수량 합 = 하단 채널별 수량 합 = DB 해당 일자 `quantity` 합.

## 5. 총 재고 금액 계산식

- 행 단위: `total_price` 우선, `≤0` 이고 `quantity>0` 이면 `quantity × unit_cost`.
- KPI `totalValue`: 제품별로 **채널** 행을 합친 뒤 **합산 금액** (quick API의 `merged[code].price` 합).

## 6. 수정 파일 목록 (누적)

| 파일 | 변경 |
|------|------|
| `src/lib/inventoryChannels.ts` | `normalizeDestWarehouse` — 판매채널 `"쿠팡"`\|`"일반"` |
| `src/lib/inventorySnapshotAggregate.ts` | `channelTotals` — quick/KPI 공통 |
| `src/app/api/inventory/quick/route.ts` | `channelTotals` (+ 호환 `stockByWarehouse`) |
| `src/app/api/inventory/snapshot/route.ts` | 동일 |
| `src/context/InventoryContext.tsx` | `channelTotals` 상태 |
| `src/components/DashboardBoxHero.tsx` | 상단/하단 **채널** 문구·`channelTotals` |
| `src/app/api/category-trend/route.ts` | 당월 입고 분해 `inboundByChannel`, `thisMonthInboundByChannel` |
| `src/components/CategoryTrendChart.tsx` | 입고 보조 문구 |

## 7. 검증 체크리스트 (배포 후)

- [ ] Supabase에서 최신 일자: `SELECT snapshot_date FROM inventory_stock_snapshot ORDER BY snapshot_date DESC LIMIT 1`
- [ ] `SUM(quantity)`, `SUM(total_price)` (필요 시 `total_price` 보정 행만 재계산)가 `quick` JSON의 `totalQuantity`, `totalValue`와 일치
- [ ] `channelTotals["쿠팡"]` + `channelTotals["일반"]` = 위 `SUM(quantity)`
- [ ] DashboardBoxHero 상단 "쿠팡: …EA / 일반: …EA" = 하단 채널별 합계

## 8. 수정 전/후 수치 (예시)

| 항목 | 수정 전 (원인 있을 때) | 수정 후 |
|------|-------------------------|---------|
| 상단 쿠팡 EA | 0 ( `"쿠팡"` 키 미인식 ) | DB `dest_warehouse` 정규화 기준과 동일 |
| 상단 일반 EA | 전체 수량에 가까움 | 쿠팡 제외한 일반만 |
| 채널 라벨 `쿠팡` | (일반)으로 잘못 표시 가능 | (쿠팡)으로 표시 |

※ 실제 숫자는 배포 후 `GET /api/inventory/quick?debug=1` 및 SQL로 대조.
