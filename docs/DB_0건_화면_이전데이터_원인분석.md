# DB 0건인데 화면에 이전 데이터가 보이는 원인 분석

## 요약

DB 테이블 row count가 0인데 로컬 서버·모바일 서버 화면에 이전 데이터가 남아 보이는 현상의 원인 후보와 확인 방법을 정리했습니다.

---

## 1. 원인 후보 우선순위

### 1순위: Supabase 프로젝트 불일치 (로컬 vs 모바일)

| 구분 | 환경변수 출처 | Supabase 프로젝트 |
|------|---------------|-------------------|
| 로컬 서버 | `.env.local` | 프로젝트 A (확인한 DB, 0건) |
| 모바일 서버 (Vercel) | Vercel Environment Variables | 프로젝트 B (다른 프로젝트, 데이터 있음) |

- **증상**: 로컬에서 row count 확인한 DB는 0건인데, Vercel 배포 URL에서 접속하면 이전 데이터가 보임
- **이유**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`가 로컬과 Vercel에서 서로 다른 Supabase 프로젝트를 가리킬 수 있음
- **참고**: `docs/데이터_사라짐_해결가이드.md`에서도 동일 원인을 1순위로 제시

### 2순위: 브라우저/탭 미새로고침 (React 메모리 상태 유지)

- **증상**: DB를 비운 뒤에도 화면에 이전 데이터가 그대로 보임
- **이유**: 페이지를 새로고침하지 않으면 `InventoryContext`의 React state가 이전 API 응답 결과를 그대로 유지
- **데이터 흐름**: `refresh()` → `/api/inventory/quick` → `setSupabaseProducts`, `setSupabaseStockSnapshot` 등 → `supabaseDerived`로 화면 렌더링
- **확인**: 브라우저 강력 새로고침(Ctrl+Shift+R) 또는 탭 닫았다가 다시 열기

### 3순위: fetch 실패 시 inventory_sync / localStorage 복원

- **증상**: API 타임아웃·네트워크 오류 시 이전에 백업해 둔 데이터가 표시됨
- **이유**: `refresh()`의 `catch` 블록에서 `fetchDefaultWorkspace()` 또는 `fetchFromCloud()`로 `inventory_sync` 테이블에서 JSON 백업을 가져와 `storage.restoreFromBackup()` 후 localStorage에 복원
- **데이터 소스**: `inventory_sync` 테이블 (inventory_inbound/outbound/snapshot과 별도)
- **조건**: API 요청이 실패하거나 8초 타임아웃에 걸렸을 때만 해당 경로 실행

### 4순위: localStorage 직접 저장 데이터

- **증상**: Supabase가 비어 있어도 로컬에서 입력·저장한 데이터가 보임
- **이유**: `useSupabaseInventory=false`일 때 `localDerived`가 `baseStock`, `transactions`, `products` 등 localStorage 기반 데이터 사용
- **저장 키**: `inventory-stock`, `inventory-transactions`, `inventory-products`, `inventory-base-stock`, `inventory-base-stock-by-product`, `inventory-daily-stock`
- **조건**: "로컬 모드로 전환" 후 데이터 입력, 또는 sync 복원으로 localStorage가 채워진 경우

### 5순위: Vercel 빌드 시점 환경변수

- **증상**: Vercel에 최신 환경변수를 넣었는데도 예전 프로젝트를 바라봄
- **이유**: `NEXT_PUBLIC_*` 변수는 빌드 시점에 번들에 포함됨. 환경변수 변경 후 재배포가 필요
- **확인**: Vercel 대시보드에서 최근 배포가 환경변수 변경 이후에 이루어졌는지 확인

### 6순위: CDN/Edge 캐시

- **가능성**: 낮음. `/api/inventory/quick`는 `export const dynamic = "force-dynamic"` 및 `Cache-Control: no-store, max-age=0` 사용
- **확인**: 개발자 도구 Network 탭에서 API 응답 헤더 확인

---

## 2. 실제 확인 방법

### 2.1 Supabase 프로젝트 일치 여부

| 확인 항목 | 로컬 | 모바일 (Vercel) |
|-----------|------|-----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | `.env.local` | Vercel Settings → Environment Variables |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `.env.local` | 동일 |
| Supabase 프로젝트 ref | URL에서 `https://xxxxx.supabase.co`의 `xxxxx` | 동일한지 비교 |

**실행**:
```bash
# 로컬: .env.local 값 출력 (민감정보 주의)
# Vercel: 프로젝트 → Settings → Environment Variables에서 직접 비교
```

### 2.2 화면이 사용하는 API·데이터 소스

| 화면 영역 | 데이터 소스 | API/테이블 |
|-----------|-------------|------------|
| KPI 카드 (재고금액, 품목수 등) | `kpiData` | `/api/inventory/quick` → `inventory_stock_snapshot` |
| 품목 카드/테이블 | `inventoryProducts`, `stockSnapshot` | 동일 |
| 판매·입고 추세 | `categoryTrendData` | `/api/category-trend` → `inventory_inbound`, `inventory_outbound` |
| AI 수요 예측 | `aiForecastByProduct` | `/api/forecast` → `inventory_outbound` |
| 로컬 모드 데이터 | `baseStock`, `transactions`, `products` | localStorage |

- **핵심**: 메인 대시보드는 `/api/inventory/quick` → `inventory_stock_snapshot` 단일 테이블에 의존
- **다른 테이블**: `inventory_inbound`, `inventory_outbound`, `inventory_products`, `inventory_sync` (sync용)

### 2.3 API 응답이 0건인지 확인

1. **브라우저 개발자 도구** → Network 탭
2. 페이지 새로고침
3. `quick` 또는 `snapshot` 요청 선택 → Response 확인
4. `items: []`, `totalValue: 0`이면 API는 0건 반환
5. 이 경우 `InventoryContext`는 `empty_data`로 `useSupabaseInventory=false` 설정 후 early return

**해석**:
- API 응답이 0건인데 화면에 데이터가 보이면 → **2순위(React state 유지)** 또는 **4순위(localStorage)** 가능성
- API 응답에 데이터가 있으면 → **1순위(다른 Supabase 프로젝트)** 가능성

### 2.4 프론트 캐시 여부

| 캐시 종류 | 사용 여부 | 비고 |
|-----------|-----------|------|
| React Query | 미사용 | - |
| SWR | 미사용 | - |
| Zustand | 미사용 | - |
| localStorage | 사용 | `store.ts`, `sync.ts` - 로컬 모드·sync 백업용 |
| sessionStorage | 미사용 | - |
| Service Worker | 미사용 | - |

- `refresh()` 호출 시 `cache: "no-store"`, `Cache-Control: no-cache`, `Pragma: no-cache`, `_t=${Date.now()}`로 캐시 회피
- **localStorage**: `useSupabaseInventory=false`일 때만 사용. 이전에 저장된 데이터가 있으면 그대로 표시됨

### 2.5 서버 메모리 캐시

- Next.js API Route는 요청마다 새로 실행
- 전역 변수로 조회 결과를 들고 있는 로직 없음
- `inventoryApi.ts`의 `getSupabase()`는 매번 `createClient` 호출

### 2.6 모바일 서버 배포 버전 확인

**Vercel**:
- 프로젝트 → Deployments → 최신 배포의 커밋 해시, 배포 시각 확인
- 환경변수 변경 후 재배포가 있었는지 확인

**로컬**:
```bash
git rev-parse HEAD
git log -1 --oneline
```

---

## 3. 해결 방법

### 3.1 Supabase 프로젝트 불일치

1. Vercel → Settings → Environment Variables
2. `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`가 `.env.local`과 동일한지 확인
3. 다르면 수정 후 **Redeploy** (환경변수 변경 시 재배포 필요)

### 3.2 React state 유지 (탭 미새로고침)

1. 브라우저 강력 새로고침 (Ctrl+Shift+R 또는 Cmd+Shift+R)
2. 또는 탭을 닫았다가 URL을 다시 열기

### 3.3 inventory_sync / localStorage 복원 데이터

1. **inventory_sync**: Supabase Table Editor에서 `inventory_sync` 테이블 확인. 필요 시 해당 행 삭제
2. **localStorage**: 개발자 도구 → Application → Local Storage → `inventory-*` 키 삭제 후 새로고침

### 3.4 캐시 무효화

- `refresh()`는 이미 `cache: "no-store"` 사용
- 문제 지속 시 브라우저 시크릿 모드에서 접속해 동일 현상 여부 확인

---

## 4. 수정이 필요한 파일 목록

**현재는 코드 수정 없이 분석만 수행했습니다.**

추가로 고려할 수 있는 변경:

| 목적 | 파일 | 내용 |
|------|------|------|
| 디버깅용 프로젝트 ID 표시 | `src/components/SupabaseInventoryRefresh.tsx` 또는 새 컴포넌트 | API 응답에 `project_ref` 또는 URL 일부 포함해 화면에 표시 |
| empty_data 시 localStorage 로드 | `src/context/InventoryContext.tsx` | `empty_data` 분기에서도 localStorage를 로드할지 정책 결정 (현재는 로드하지 않음) |
| inventory_sync 사용 여부 명시 | `src/context/InventoryContext.tsx` | catch 블록에서 inventory_sync 복원 시 사용자에게 안내 메시지 표시 |

---

## 5. 빠른 체크리스트

- [ ] 로컬 `.env.local`의 `NEXT_PUBLIC_SUPABASE_URL`과 Vercel 환경변수 비교
- [ ] 브라우저 강력 새로고침 후에도 이전 데이터가 보이는지 확인
- [ ] Network 탭에서 `/api/inventory/quick` 응답의 `items`, `totalValue` 확인
- [ ] Application → Local Storage에서 `inventory-*` 키 존재 여부 확인
- [ ] Supabase Table Editor에서 `inventory_sync` 테이블 데이터 확인
- [ ] Vercel Deployments에서 최신 배포 시점과 환경변수 변경 시점 비교
