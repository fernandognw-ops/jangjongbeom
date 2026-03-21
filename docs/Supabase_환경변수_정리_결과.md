# Supabase 환경변수 정리 결과

## 1. 비교 결과 (2025-03-17)

| 변수 | 로컬 (.env.local) | Vercel (Production) | 일치 |
|------|------------------|----------------------|------|
| NEXT_PUBLIC_SUPABASE_URL | `https://slnmhblsxzjgmaqbfbwa.supabase.co` | 동일 | ✅ |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | `eyJ...` (JWT) | 동일 | ✅ |
| SUPABASE_SERVICE_ROLE_KEY | 미사용 | 미사용 | - |

**결론**: 로컬과 Vercel이 **동일한 Supabase 프로젝트** (`slnmhblsxzjgmaqbfbwa`)를 바라보고 있음.

### SUPABASE_SERVICE_ROLE_KEY
- 앱 코드에서 사용하지 않음 (grep 결과 0건)
- 서버 전용 작업(예: RLS 우회)이 필요할 때만 Supabase 대시보드에서 확인 후 별도 설정
- **클라이언트/API에 노출 금지**

---

## 2. 재배포 필요 여부

### NEXT_PUBLIC_* 변수
- **빌드 시점**에 번들에 포함됨
- 환경변수 **값을 변경한 경우** → **반드시 재배포** 필요
- 이번 검증 시 **값 변경 없음** → 재배포는 코드 반영(quick API 검증 필드 추가) 목적만 수행

### 재배포 실행
```bash
npx vercel --prod
```
또는 Git push → Vercel 자동 배포

---

## 3. 검증 방법

### /api/inventory/quick 응답
응답에 `_supabase_project_ref` 필드가 포함됨:
```json
{
  "items": [...],
  "totalValue": 0,
  "productCount": 0,
  "_supabase_project_ref": "slnmhblsxzjgmaqbfbwa"
}
```

### 확인 절차
1. **로컬**: `http://localhost:3007/api/inventory/quick` → `_supabase_project_ref` 확인 (dev 서버 재시작 후)
2. **배포**: `https://jangjongbeom.vercel.app/api/inventory/quick` → 동일한 값인지 확인
3. **데이터 진단**: 대시보드 "데이터 진단" 버튼 → `[Supabase: slnmhblsxzjgmaqbfbwa]` 표시 확인

### 통합 검증 스크립트
```bash
# 로컬 dev 서버 실행 후 (npm run dev)
npm run verify-supabase-unified
```
