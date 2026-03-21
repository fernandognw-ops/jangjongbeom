# `sales_channel` 전부 NULL — 원인·대응

## 1. 코드 점검 결과 (앱)

### `commitProductionSheet.ts`

- `inventory_stock_snapshot` insert 배치 객체에 **`sales_channel`** 필드가 **항상 포함**됩니다 (`normalizeSalesChannelKr(...)`).
- insert 직전 첫 배치에 `sales_channel` 키 존재 여부를 검사하며, 누락 시 예외를 던지도록 했습니다.

→ **현재 배포된 웹 커밋 경로**로 당월 데이터를 넣었다면 NULL이 아닌 `'쿠팡'`/`'일반'` 문자열이 들어가는 것이 정상입니다.

### 파서 (`parseStockSheet` + `productionSheetParser`)

- 재고 시트 2행 헤더에서 `stock_sales_channel` 동의어로 **「판매 채널」열**을 찾습니다.
- 열을 **못 찾으면** (`inspectStockSheetHeaders` → `salesChannelColumnFound: false`) 모든 행의 채널은 **`일반`**으로만 채워집니다 (NULL이 아님).
- 파싱 결과는 `stockSnapshot[].sales_channel`에 문자열로 전달됩니다.

→ **414건이 모두 NULL**인 것은, 파서 “미인식 → 일반” 케이스와 맞지 않습니다. (그 경우 DB에는 `'일반'`이 들어가야 함)

## 2. DB NULL의 일반적 원인

| 원인 | 설명 |
|------|------|
| **컬럼 추가 전 적재** | `ALTER TABLE ... ADD sales_channel` 이후 기존 행은 NULL로 남음 |
| **sales_channel 없이 INSERT** | 구버전 스크립트·수동 SQL·다른 클라이언트가 해당 컬럼 없이 insert |
| **마이그레이션 미실행** | 앱은 넣는데 테이블에 컬럼이 없었다가 나중에 추가됨 |

## 3. DB 점검 SQL

`scripts/check_snapshot_sales_channel.sql` 실행.

## 4. 원칙 (권장)

- **정확한 판매채널**은 엑셀 「판매 채널」열에만 있으므로, NULL/잘못된 행이 많으면:
  1. `inventory_stock_snapshot` 해당 일자(또는 전체) **삭제**
  2. 동일 엑셀 **웹 업로드 → 검증 → 커밋** 으로 재적재

검증 API 응답의 **`stockSalesChannelColumnFound`** 가 `true`인지 확인할 것.

## 5. 임시 SQL

`scripts/fix_snapshot_sales_channel_temp.sql` — **레거시 `dest_warehouse` 기준 추론**으로 NULL만 채움.  
**임시**이며, 물리 창고명만 있는 데이터는 부정확할 수 있음.
