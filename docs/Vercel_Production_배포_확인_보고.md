# Vercel Production 배포 확인 보고

## 1. 현재 Production 커밋

| 항목 | 값 |
|------|-----|
| **이전** | `744a5d8` (feat: common/excelParser 공용 파서 통합) |
| **배포됨** | `3c79c64` (feat: 웹 UI 승인 기반 업로드) |
| **푸시** | 2026-03-19 완료 |

---

## 2. Production env 반영 여부

| 변수 | .env.vercel.production | 필요 여부 |
|------|-------------------------|------------|
| NEXT_PUBLIC_SUPABASE_URL | ✅ 있음 | 필수 |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | ✅ 있음 | 필수 |
| ALLOW_DB_WRITE | ❌ 없음 | **권장** (미설정 시 기본 허용) |

**ALLOW_DB_WRITE 추가 방법:**
1. [Vercel Dashboard](https://vercel.com) → 프로젝트 → Settings → Environment Variables
2. Key: `ALLOW_DB_WRITE`, Value: `true`
3. Environment: Production 체크
4. Save 후 **Redeploy** (또는 다음 배포 시 자동 반영)

> 참고: `ALLOW_DB_WRITE`가 없어도 `!== "false"` 조건으로 commit API는 동작함. 명시적 설정 권장.

---

## 3. 재배포 여부

- **Git push**로 자동 배포 트리거됨 (`744a5d8` → `3c79c64`)
- Vercel이 1~3분 내 빌드·배포 완료 예상

---

## 4. 업로드 UI 노출 여부 (배포 완료 후 확인)

| 항목 | 예상 |
|------|------|
| "생산수불현황 업로드 (웹 UI 승인 기반)" | 데이터 없을 때 상단, 있을 때 KPI 아래 |
| 파일 드래그/선택 영역 | ✅ |
| validate → commit 흐름 | ✅ |

---

## 5. validate/commit 동작 여부 (배포 완료 후 확인)

| API | 배포 전 | 배포 후 |
|-----|---------|---------|
| POST /api/production-sheet-validate | 404 | 200 (파일 업로드 시) |
| POST /api/production-sheet-commit | 404 | 200 (previewToken 시) |
| GET /api/inventory/quick | ✅ 정상 (0건) | ✅ 정상 |

---

## 6. 배포 후 검증 절차

1. https://jangjongbeom.vercel.app 접속
2. "생산수불현황 업로드" 섹션 노출 확인
3. Excel 파일 드래그 → 검증 결과 표시 확인
4. "DB 반영" 클릭 → 성공 메시지 확인
5. KPI 갱신 확인
