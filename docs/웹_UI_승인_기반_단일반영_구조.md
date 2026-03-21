# 웹 UI 승인 기반 단일 반영 구조

## 개요

실제 DB 반영은 **웹 UI를 통한 승인 경로에서만** 가능합니다.  
로컬 스크립트, 직접 API 호출, 테스트 스크립트로는 운영 DB 반영이 불가합니다.

---

## 1. API 구조

### validate (1단계 검증)

| 항목 | 내용 |
|------|------|
| **엔드포인트** | `POST /api/production-sheet-validate` |
| **Body** | FormData (file: Excel) |
| **동작** | 파일 업로드 → 서버 파싱 → 검증 결과 반환 |
| **DB** | 저장 금지 |
| **응답** | `{ ok, validation, previewToken }` |

### commit (2단계 DB 반영)

| 항목 | 내용 |
|------|------|
| **엔드포인트** | `POST /api/production-sheet-commit` |
| **헤더** | `x-source: web` 필수 |
| **Body** | `{ previewToken: string }` |
| **동작** | previewToken 검증 → 승인된 데이터만 DB 반영 |
| **조건** | validate 성공 후 발급된 previewToken 필요 |

### deprecated API (410)

| 엔드포인트 | 대체 |
|------------|------|
| `POST /api/production-sheet-upload/parse` | `POST /api/production-sheet-validate` |
| `POST /api/production-sheet-upload` | `POST /api/production-sheet-commit` |

---

## 2. validate → commit 흐름

```
[사용자] Excel 업로드
    ↓
[validate API] 서버 파싱 → 검증 → previewToken 발급 (5분 TTL)
    ↓
[웹 화면] 검증 결과 표시 (rawdata, 입고, 출고, 재고, 총금액, 일반/쿠팡, snapshot_date)
    ↓
[사용자] "DB 반영" 클릭 (오류 없을 때만 활성화)
    ↓
[commit API] previewToken 검증 → DB 반영 → inventory_upload_logs 기록
```

---

## 3. 차단된 경로

| 경로 | 차단 방식 |
|------|-----------|
| 로컬 스크립트 `integrated_sync.py --apply` | 기본 차단. `ALLOW_SCRIPT_APPLY=true` 시에만 허용 (로컬 테스트용) |
| 직접 API 호출 (curl, Postman 등) | commit API는 `x-source: web` + `previewToken` 검증 |
| validate 없이 commit 요청 | previewToken 없음 → 403 |
| 테스트 스크립트 | `x-source: web` 없으면 403, previewToken 없으면 403 |

---

## 4. DB 쓰기 보호

| 환경변수 | 값 | 동작 |
|----------|-----|------|
| `ALLOW_DB_WRITE` | `false` | 모든 insert/upsert 차단 (commit API 503) |
| `ALLOW_DB_WRITE` | `true` | 웹 승인 경로에서만 허용 (previewToken 검증) |

---

## 5. 업로드 로그 테이블 (inventory_upload_logs)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | UUID | PK |
| uploaded_at | TIMESTAMPTZ | 업로드 시각 |
| uploaded_by | TEXT | 업로드 주체 (기본: web) |
| source | TEXT | 출처 (기본: web) |
| filename | TEXT | 파일명 |
| snapshot_date | TEXT | 재고 시점 |
| rawdata_count | INTEGER | rawdata 건수 |
| inbound_count | INTEGER | 입고 건수 |
| outbound_count | INTEGER | 출고 건수 |
| stock_count | INTEGER | 재고 건수 |
| total_value | NUMERIC | 재고 총 금액 |
| general_count | INTEGER | 일반 창고 건수 |
| coupang_count | INTEGER | 쿠팡 창고 건수 |
| status | TEXT | success / error |
| error_message | TEXT | 실패 시 오류 메시지 |

**생성 스크립트:** `scripts/create_inventory_upload_logs.sql`

---

## 6. 과거월 보호

- `inventory_stock_snapshot`은 **당월만** 반영 허용
- 전월 이전 수정 금지 (commit 로직에서 필터링)

---

## 7. 변경 파일 목록

| 파일 | 변경 내용 |
|------|-----------|
| `src/app/api/production-sheet-validate/route.ts` | 1단계 검증 API (신규) |
| `src/app/api/production-sheet-commit/route.ts` | 2단계 DB 반영 API (신규) |
| `src/app/api/production-sheet-upload/route.ts` | 410 deprecate |
| `src/app/api/production-sheet-upload/parse/route.ts` | 410 deprecate |
| `src/lib/previewTokenStore.ts` | previewToken 저장소 |
| `src/lib/commitProductionSheet.ts` | DB 반영 로직 |
| `src/components/ProductionSheetUploader.tsx` | validate → commit 흐름, 검증 UI |
| `scripts/integrated_sync.py` | --apply 운영 차단 |
| `scripts/create_inventory_upload_logs.sql` | 업로드 로그 테이블 스키마 |

---

## 8. 환경변수 설정

```env
# .env.local (로컬 개발)
ALLOW_DB_WRITE=true

# Vercel 프로덕션
ALLOW_DB_WRITE=true   # 웹 UI 승인 시에만 실제 반영됨
```

---

## 9. Supabase 설정

1. `scripts/create_inventory_upload_logs.sql` 실행 필요
2. Supabase SQL Editor에서 실행
