# 운영 정책: DB 반영 강제

웹 UI를 통한 업로드만 DB 반영이 가능하도록 강제

---

## 1. API 직접 호출 차단

**대상**: `POST /api/production-sheet-upload` (action=apply)

**규칙**:
- `x-source: web` 헤더가 있는 요청만 허용
- 외부 fetch, curl, 스크립트 호출은 403 차단

**웹 UI**: `ProductionSheetUploader`에서 `x-source: web` 자동 전송

**차단 시 응답**:
```json
{
  "error": "웹 UI에서만 DB 반영 가능합니다. API 직접 호출·스크립트는 차단됩니다.",
  "hint": "대시보드 → Excel 업로드 → 검증 → DB 반영 클릭"
}
```

---

## 2. integrated_sync.py 차단

**규칙**:
- 기본 실행: 무조건 dry-run (DB 미반영)
- 실제 DB 반영: `--apply` 옵션 명시 시에만 가능
- dry-run 시 로그에 `[운영 반영 금지]` 표시

**사용**:
```bash
python scripts/integrated_sync.py "파일.xlsx"        # dry-run (기본)
python scripts/integrated_sync.py "파일.xlsx" --apply  # DB 반영 (비권장)
```

---

## 3. 테스트/스크립트 insert 금지

**verify 스크립트**: read-only (API GET만 호출)
- `verify_reset_complete.mjs`
- `verify_supabase_unified.mjs`

**bulk-upload-production-sheet.mjs**: API 호출 시 403 차단 (x-source 없음)

---

## 4. DB 반영 로그

모든 insert/upsert 시 로그:
```
[DB_WRITE] source=web table=inventory_products rows=300 dryRun=false ts=2026-03-19T...
```

---

## 5. 임시 보호 모드 (ALLOW_DB_WRITE)

**환경변수**: `ALLOW_DB_WRITE`

| 값 | 동작 |
|----|------|
| `false` | 모든 insert/upsert 차단, 503 반환, 로그만 출력 |
| 미설정 또는 `true` | 정상 동작 |

**.env.local**:
```
ALLOW_DB_WRITE=false   # 보호 모드 (DB 쓰기 차단)
ALLOW_DB_WRITE=true    # 정상 (기본)
```

---

## 요약

| 경로 | DB 반영 |
|------|---------|
| 웹 UI (대시보드 업로드) | ✅ 허용 |
| API 직접 호출 (x-source 없음) | ❌ 403 |
| integrated_sync.py (기본) | ❌ dry-run |
| integrated_sync.py --apply | ⚠️ 가능 (비권장) |
| bulk-upload 스크립트 | ❌ 403 |
| verify 스크립트 | ✅ read-only (insert 없음) |
