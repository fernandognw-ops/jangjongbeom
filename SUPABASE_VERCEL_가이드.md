# Supabase ↔ Vercel 연동 가이드

전 직원이 실시간으로 데이터를 공유하려면 Supabase와 Vercel을 연결해야 합니다.

---

## 1단계: Supabase에서 URL과 키 찾기

1. [Supabase 대시보드](https://supabase.com/dashboard) 접속
2. 왼쪽 메뉴에서 **Project Settings** (톱니바퀴 아이콘) 클릭
3. **API** 메뉴 클릭
4. 아래 항목을 확인합니다:

| 환경 변수 이름 | Supabase 화면에서 찾는 위치 |
|----------------|---------------------------|
| `NEXT_PUBLIC_SUPABASE_URL` | **Project URL** (예: `https://abcdefgh.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Project API keys** → **anon** **public** (긴 JWT 문자열) |

> ⚠️ **anon public** 키를 사용하세요. `service_role` 키는 절대 클라이언트에 노출하면 안 됩니다.

---

## 2단계: Supabase 테이블 생성

1. Supabase 대시보드 → **SQL Editor** → **New query**
2. 프로젝트의 `supabase-setup.sql` 파일 내용을 복사해 붙여넣기
3. **Run** 버튼 클릭
4. "Success" 메시지 확인

---

## 3단계: Vercel에 환경 변수 추가

1. [Vercel 대시보드](https://vercel.com/dashboard) 접속
2. **jangjongbeom** 프로젝트 클릭
3. 상단 **Settings** 탭 클릭
4. 왼쪽 메뉴에서 **Environment Variables** 클릭
5. 아래처럼 두 개의 변수를 추가합니다:

### 변수 1
- **Key**: `NEXT_PUBLIC_SUPABASE_URL`
- **Value**: Supabase에서 복사한 Project URL (예: `https://abcdefgh.supabase.co`)
- **Environment**: Production, Preview, Development 모두 체크

### 변수 2
- **Key**: `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- **Value**: Supabase에서 복사한 anon public 키 (전체 JWT 문자열)
- **Environment**: Production, Preview, Development 모두 체크

6. 각 변수 입력 후 **Save** 클릭

---

## 4단계: 재배포

환경 변수 추가 후 **반드시 재배포**해야 적용됩니다.

1. Vercel 프로젝트 → **Deployments** 탭
2. 최신 배포 오른쪽 **⋯** 메뉴 → **Redeploy** 클릭
3. **Redeploy** 확인

또는 GitHub에 새 커밋을 푸시하면 자동으로 재배포됩니다.

---

## 5단계: 전 직원 데이터 공유 방법

1. **관리자(PC)**: https://jangjongbeom.vercel.app 접속
2. **"연동코드 생성 (PC)"** 버튼 클릭
3. 표시된 **12자리 코드**를 메모 (예: `AB3K7M9PQR2X`)
4. 해당 코드를 **전 직원에게 전달** (카카오톡, 메모, 메일 등)
5. **각 직원**: 자신의 PC/모바일에서 사이트 접속 → 코드 입력 → **"연동하기"** 클릭
6. 이후 모든 기기에서 **실시간으로 동일한 데이터**가 공유됩니다.

---

## 로컬 개발용 (.env.local)

로컬에서 테스트할 때는 프로젝트 루트에 `.env.local` 파일을 만들고:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

위 형식으로 값을 넣은 뒤 `npm run dev`로 실행하세요.

> `.env.local`은 Git에 올라가지 않습니다. (이미 .gitignore에 포함됨)
