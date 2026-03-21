# Vercel 배포 가이드

## 1. 환경 변수 설정 (Vercel 대시보드)

### 1.1 접속
1. [vercel.com](https://vercel.com) 로그인
2. 프로젝트 선택 (inventory-system 또는 jangjongbeom)
3. **Settings** → **Environment Variables**

### 1.2 필수 환경 변수 (Supabase)

| 변수명 | 값 | 환경 |
|--------|-----|------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://slnmhblsxzjgmaqbfbwa.supabase.co` | Production, Preview, Development |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `.env.local`의 `NEXT_PUBLIC_SUPABASE_ANON_KEY` 값 그대로 | Production, Preview, Development |

> ⚠️ **주의**: `NEXT_PUBLIC_` 접두사 변수는 클라이언트에 노출됩니다.  
> Supabase **anon key**만 사용하고, **service_role key**는 절대 넣지 마세요.

### 1.3 선택 환경 변수

| 변수명 | 용도 | 환경 |
|--------|------|------|
| `NEXT_PUBLIC_APP_URL` | 앱 기본 URL (알림 링크 등) | Production |
| `KAKAO_CHAT_WEBHOOK_URL` | 품절 알림 카카오 웹훅 | Production |
| `NAVER_CLIENT_ID` | 네이버 검색 트렌드 API | Production |
| `NAVER_CLIENT_SECRET` | 네이버 검색 트렌드 API | Production |

### 1.4 .env.local과 동일하게 설정하는 방법
1. 로컬 `.env.local` 파일 열기
2. Vercel 대시보드에서 각 변수 **Add** 클릭
3. **Key**: 변수명, **Value**: .env.local의 값 복사
4. **Environment**: Production, Preview, Development 모두 체크 (Supabase는 필수)

---

## 2. 배포 방법

### 방법 A: Git 푸시 (권장)
- GitHub에 푸시하면 Vercel이 자동 배포
- `main` 브랜치 푸시 → Production 배포

### 방법 B: Vercel CLI
```bash
# 1. 로그인 (최초 1회)
npx vercel login

# 2. 프로덕션 배포
npx vercel --prod
```

---

## 3. 빌드 검증 결과 (2025-03-17)

- ✅ `npm run build` 성공
- ✅ 창고 분류, 엑셀 업로드, 재고 상태 로직 포함 빌드 완료
- ⚠️ ESLint useMemo 경고 5건 (빌드 차단 아님)

---

## 4. 최종 접속 URL

배포 완료 후:
- **Production**: `https://jangjongbeom.vercel.app` (또는 Vercel이 부여한 도메인)
- Vercel 대시보드 → 프로젝트 → **Domains**에서 확인

직원들에게 공유할 URL: **https://jangjongbeom.vercel.app**
