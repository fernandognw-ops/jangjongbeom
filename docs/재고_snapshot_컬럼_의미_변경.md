# inventory_stock_snapshot 컬럼 의미 (2025-03)

## 수정 전 (잘못된 모델)

| 컬럼 | 잘못된 사용 |
|------|-------------|
| `dest_warehouse` | 보관센터명(테이칼튼 등)을 넣은 뒤, 이름으로 쿠팡/일반 **추론** |
| (별도) | 엑셀 「판매 채널」이 `sales_channel` 등에만 있고 집계와 불일치 가능 |

## 수정 후 (올바른 모델)

| 컬럼 | 의미 |
|------|------|
| `dest_warehouse` | 엑셀 **「판매 채널」** → `normalizeSalesChannelKr` → **`쿠팡` \| `일반`** |
| `storage_center` | 엑셀 **「보관 센터」** (실제 물류/창고명) |
| `sales_channel` | 레거시 DB 호환 — 신규 적재 시 **`dest_warehouse`와 동일 값** 권장 |

집계(`channelForSnapshotRow` — quick / snapshot / summary / kpi)는 **`sales_channel`을 우선**, 없으면 `dest_warehouse`를 `normalizeSalesChannelKr`만 적용합니다. 보관센터명·테이칼튼 추론은 사용하지 않습니다. (레거시로 `dest_warehouse`만 잘못된 경우 엑셀 판매채널이 `sales_channel`에 남아 있으면 그 값이 맞춰집니다.)

## DB 마이그레이션

- `scripts/migrate_snapshot_dest_channel_storage.sql` 실행
- 기존 데이터가 보관센터 기준으로만 들어가 있었다면 **TRUNCATE 후 동일 엑셀 재업로드** 권장

## 엑셀 vs DB 수량 검증

1. 엑셀: 「판매 채널」별로 `수량` 합산
2. DB: `snapshot_date` 최신일 기준 `dest_warehouse`별 `SUM(quantity)`
3. 동일 스냅샷일·동일 채널이면 합계가 일치해야 함 (`storage_center`가 여러 개면 행이 나뉘어 있어도 채널 합계는 동일)

## 관련 코드

- 파싱: `src/lib/excelParser/parser.ts` (`parseStockSheet`)
- 적재: `src/lib/commitProductionSheet.ts`
- 집계: `src/lib/inventorySnapshotAggregate.ts` (`channelForSnapshotRow`)
- Python 동기화: `common/parser.py`, `scripts/integrated_sync.py`
