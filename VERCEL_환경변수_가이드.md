# Vercel 환경 변수 설정 가이드

전 직원이 실시간으로 재고를 공유하려면 Vercel에 Supabase 연결 정보를 추가해야 합니다.

---

## 1단계: Vercel 대시보드 접속

1. [vercel.com](https://vercel.com) 로그인
2. **jangjongbeom** 프로젝트 클릭
3. 상단 **Settings** 탭 클릭
4. 왼쪽 메뉴에서 **Environment Variables** 클릭

---

## 2단계: 환경 변수 추가

**Add New** 버튼을 클릭한 뒤 아래 2개 변수를 추가합니다.

### 변수 1: NEXT_PUBLIC_SUPABASE_URL

| 항목 | 값 |
|------|-----|
| **Key** | `NEXT_PUBLIC_SUPABASE_URL` |
| **Value** | Supabase Project URL (예: `https://abcdefgh.supabase.co`) |
| **Environment** | Production, Preview, Development 모두 체크 |

> 📍 **URL 확인**: Supabase 대시보드 → Project Settings → API → **Project URL**

### 변수 2: NEXT_PUBLIC_SUPABASE_ANON_KEY

| 항목 | 값 |
|------|-----|
| **Key** | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| **Value** | `sb_publishable_c9Zi3Tgwg9J2ciy1AChYfA_3dCf0ZGa` |
| **Environment** | Production, Preview, Development 모두 체크 |

> ⚠️ **Secret Key** (`sb_secret_...`)는 **절대** Vercel 환경 변수에 넣지 마세요. 클라이언트에 노출되면 안 됩니다.

---

## 3단계: 저장 및 재배포

1. 각 변수 입력 후 **Save** 클릭
2. **Deployments** 탭으로 이동
3. 최신 배포 오른쪽 **⋯** 메뉴 → **Redeploy** 클릭
4. **Redeploy** 확인

환경 변수는 재배포 후에만 적용됩니다.

---

## 4단계: Supabase 테이블 생성

아직 실행하지 않았다면:

1. Supabase 대시보드 → **SQL Editor** → **New query**
2. 프로젝트의 `supabase-setup.sql` 내용 붙여넣기
3. **Run** 클릭

---

## 완료 후

배포가 끝나면 https://jangjongbeom.vercel.app 에서 모든 직원이 동일한 재고 데이터를 실시간으로 공유할 수 있습니다.
