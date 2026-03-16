# 배포 가이드 (Vercel)

## 이전 배포 정보
- **플랫폼**: Vercel
- **URL**: https://jangjongbeom.vercel.app
- **Git 저장소**: https://github.com/fernandognw-ops/jangjongbeom.git

## 배포 방법

### 1. Vercel CLI로 배포 (권장)

```bash
# 1) Vercel 로그인 (최초 1회)
npx vercel login

# 2) 프로덕션 배포
npx vercel --prod
```

### 2. GitHub 연동 자동 배포

1. [vercel.com](https://vercel.com) 접속 → 로그인
2. **Add New** → **Project** → `jangjongbeom` 저장소 선택
3. 환경 변수 설정 (Settings → Environment Variables):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NAVER_CLIENT_ID` (선택)
   - `NAVER_CLIENT_SECRET` (선택)
   - `KAKAO_REST_API_KEY`, `KAKAO_CHAT_WEBHOOK_URL` (선택)
4. **Deploy** 클릭
5. 이후 `main` 브랜치에 push하면 자동 배포됨

### 3. 수동 배포 (Git push 후)

```bash
git add .
git commit -m "배포: 최신 변경사항"
git push origin main
```

GitHub와 Vercel이 연동되어 있으면 push 시 자동 배포됩니다.

## vercel.json 설정
- Framework: Next.js
- Cron: `/api/stock-alerts` 매일 0시 실행 (품절 알림)
