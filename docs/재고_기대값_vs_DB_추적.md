# 재고 일반/쿠팡 — 기대값 vs DB 추적

## 1. 기대값(예시) 출처 조사 결과

**코드·문서에 다음 수치의 출처는 없습니다.**

| 구분 | 수량(EA) |
|------|----------|
| 쿠팡 (기대) | 5,916,026 |
| 일반 (기대) | 4,644,575 |

- 저장소 전체 `grep`으로 `5916026`, `4644575`, `5916026` 등 **일치 없음**.
- 따라서 이 값은 **외부 산출**(엑셀 수동 피벗, 별도 시트, 이전 날짜 스냅샷 export, 또는 **다른 dest 매핑 규칙**)일 가능성이 큽니다.

### 문서에 있는 **다른** 지표 (혼동 주의)

`docs/첫_업로드_검증_결과_0319.md`:

| 표현 | 의미 |
|------|------|
| 일반 2,413 / 쿠팡 1,138 | **재고 행(레코드) 개수** 분포 (수량 합 아님) |
| SQL: 일반 248 / 쿠팡 166 | **dest_warehouse별 row 수** (수량 합 아님) |
| 재고 건수 414 | **스냅샷 행 수** (product×판매채널(dest)×날짜 조합) |
| snapshot_date | 예시 **2026-03-17** (`0318_생산수불현황.xlsx` 기준 문서) |

→ 위 숫자들은 **5,916,026 / 4,644,575와 직접 대응되지 않습니다.**

---

## 2. 총합 일치 → 분기만 다름

```
기대(예): 5,916,026 + 4,644,575 = 10,560,601
현재 DB:  6,090,158 + 4,470,443 = 10,560,601  (사용자 확인 기준)
```

- **총 재고 수량(EA)은 동일**합니다.
- 차이는 **일반 ↔ 쿠팡 간 이동**만 해당합니다.

| 항목 | 차이(EA) |
|------|----------|
| 쿠팡 | +174,132 (DB가 더 큼) |
| 일반 | −174,132 (DB가 더 작음) |

→ 동일 총량 중 **약 174,132 EA**가 “기대”에서는 일반, DB 최신 스냅샷에서는 쿠팡으로 집계된 것으로 해석됩니다.

---

## 3. `inventory_stock_snapshot` 적재 로직 (웹 업로드)

구현: `src/lib/commitProductionSheet.ts`

1. 파서 결과 `stockSnapshot` 배열을 `inventory_products` enrichment 후 행 생성.
2. `dest_warehouse`: `ensureDestWarehouse` → `toDestWarehouse` (엑셀 센터 문자열 → **"일반" | "쿠팡"**).
3. **당월** `snapshot_date`에 해당하는 행만 DB 반영:
   - 해당 `snapshot_date` 값들에 대해 **기존 행 DELETE** 후 **INSERT**.
4. PK: `(product_code, dest_warehouse, snapshot_date)` — 동일 키 중복이면 스키마상 1행.

### 414행 / 누락·중복

- 업로드 검증 문서 기준 **재고 414행** = 엑셀 재고 시트에서 파싱된 행 수와 맞추는 것이 목표.
- 중복 검사 SQL: `scripts/verify_after_first_upload.sql` 의 `duplicate_count` (PK 기준).

### dest_warehouse 분류

- 엑셀 `storage_center`(등) 원문 → `src/lib/excelParser/classifier.ts` 의 `toDestWarehouse`:
  - 빈 값 → 일반
  - `테이칼튼` / `쿠팡` / `coupang` 포함 → 쿠팡
  - 그 외 → 일반

대시보드 API는 `inventoryChannels.normalizeDestWarehouse`로 동일 계열 규칙을 사용합니다.

---

## 4. 엑셀 기준 수량 재계산 방법

저장소에 `.xlsx` 원본이 없으므로, **로컬에 있는 생산수불 파일**로 실행합니다.

```bash
npx tsx scripts/sum_stock_snapshot_from_excel.ts "C:\path\to\생산수불현황.xlsx"
```

출력: 파서가 만든 `stockSnapshot` 기준 **쿠팡/일반 quantity 합**, 행 수, `snapshot_date` 목록.

이 결과를 Supabase에서 **동일 날짜**로:

```sql
SELECT dest_warehouse, SUM(quantity) AS qty
FROM inventory_stock_snapshot
WHERE snapshot_date = 'YYYY-MM-DD'   -- 엑셀에 찍힌 날짜
GROUP BY dest_warehouse;
```

와 비교합니다.

---

## 5. 차이(174,132 EA 분기) 가능 원인

1. **기대값 산출 시점/파일이 다름**  
   다른 날짜 스냅샷, 다른 엑셀 버전, 수동 수정 시트.

2. **센터 컬럼 해석 차이**  
   피벗 시 “매출구분” vs “보관센터” 등 다른 열을 썼을 경우 `toDestWarehouse`와 불일치.

3. **규칙 변경**  
   `toDestWarehouse` / `normalizeDestWarehouse` 키워드(테이칼튼·쿠팡) 추가 전후로 같은 원문이 일반↔쿠팡으로 바뀔 수 있음.

4. **재업로드**  
   당월 delete-insert로 스냅샷이 덮어씌워지면서 엑셀과 다른 버전이 반영됨.

---

## 6. 요약 표

| 항목 | 내용 |
|------|------|
| 기대 5,916,026 / 4,644,575 | **레포 내 근거 없음** — 산출 근거(파일·날짜·열)를 별도 기록할 것 |
| DB 최신 (사용자 확인) | 일반 4,470,443 / 쿠팡 6,090,158 |
| 총합 | **10,560,601로 동일** |
| 차이 | **분기만** 약 174k EA (일반→쿠팡 방향으로 DB가 더 쿠팡 많음) |
| 엑셀 재검증 | `scripts/sum_stock_snapshot_from_excel.ts` + SQL `SUM(quantity)` |
