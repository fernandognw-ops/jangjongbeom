# PC·모바일 데이터 연동 설정

데이터가 PC와 모바일에서 자동으로 연동되도록 Supabase(무료)를 설정합니다.

## 1. Supabase 프로젝트 생성

1. [supabase.com](https://supabase.com) 접속 후 회원가입/로그인
2. **New Project** 클릭
3. 프로젝트 이름, 비밀번호 입력 후 생성

## 2. 테이블 생성

Supabase 대시보드 → **SQL Editor** → **New query** → `supabase-setup.sql` 내용 붙여넣기 → **Run**

## 3. 환경 변수 설정

Supabase 대시보드 → **Project Settings** → **API** 에서 확인:
- **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
- **anon public** 키 → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### 로컬 개발
`.env.local` 파일 생성:
```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Vercel 배포
Vercel 대시보드 → 프로젝트 → **Settings** → **Environment Variables** 에 동일하게 추가

## 4. 사용 방법

1. **PC**: 데이터 관리 섹션의 "연동코드 생성 (PC)" 클릭 → 12자리 코드 표시
2. **모바일**: 같은 코드를 "연동코드 입력"란에 입력 후 "연동하기" 클릭
3. 이후 데이터 변경 시 자동으로 클라우드에 저장·동기화됩니다.
