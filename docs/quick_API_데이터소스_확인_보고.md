# /api/inventory/quick 데이터 소스 확인 보고

## 결과 요약

| 항목 | 값 |
|------|-----|
| **API project ref** | `slnmhblsxzjgmaqbfbwa` |
| **SQL 실행 project ref** | Supabase Dashboard URL에서 확인 필요 |
| **inventory_stock_snapshot row count** | Supabase SQL Editor에서 실행 필요 |
| **실제 조회 테이블** | `inventory_stock_snapshot` |
| **원인** | (아래 확인 절차 후 확정) |
| **해결 방법** | (원인에 따라) |

---

## 1. API project ref

`/api/inventory/quick` 응답의 `_supabase_project_ref` 필드:

```
slnmhblsxzjgmaqbfbwa
```

→ API가 사용하는 Supabase URL: `https://slnmhblsxzjgmaqbfbwa.supabase.co`

---

## 2. SQL 실행 project ref 확인

**Supabase Dashboard** 접속 시 URL:

```
https://supabase.com/dashboard/project/[PROJECT_REF]
```

- SQL Editor에서 초기화 SQL을 실행한 프로젝트의 URL에 `slnmhblsxzjgmaqbfbwa`가 포함되어 있어야 함
- 다른 ref(예: `abcdefghijk`)가 보이면 **프로젝트 불일치**

---

## 3. inventory_stock_snapshot row count 확인

**Supabase SQL Editor**에서 실행:

```sql
SELECT COUNT(*) AS row_count FROM inventory_stock_snapshot;
```

- **0**: 초기화 적용됨 → API가 328건 반환 시 **다른 프로젝트** 참조 가능성
- **328 이상**: 초기화 미적용 → 해당 프로젝트에서 TRUNCATE 재실행 필요

---

## 4. API 내부 쿼리 (실제 조회 테이블)

`src/app/api/inventory/quick/route.ts`:

```typescript
const tableName = "inventory_stock_snapshot";

const { data: maxDateRes, error: maxErr } = await supabase
  .from(tableName)
  .select("snapshot_date")
  .order("snapshot_date", { ascending: false })
  .limit(1);
```

→ **조회 테이블: `inventory_stock_snapshot`** (다른 테이블 아님)

---

## 5. 원인 시나리오

| 상황 | 원인 | 해결 |
|------|------|------|
| project ref 일치, row count 328 | 초기화 SQL 미실행 | 해당 프로젝트에서 TRUNCATE 실행 |
| project ref 일치, row count 0, API 328건 | (거의 불가능) | - |
| project ref 불일치 | API와 SQL이 서로 다른 Supabase 프로젝트 참조 | .env.local의 `NEXT_PUBLIC_SUPABASE_URL`을 SQL 실행한 프로젝트 URL로 수정 |
| row count 0, API 0건 + error | Supabase 연결 오류 (URL/Key 형식) | .env.local 형식 점검, dev 서버 재시작 |

---

## 6. 확인 스크립트

```bash
node scripts/check_quick_api_source.mjs http://localhost:3007
```

---

## 7. Supabase 프로젝트 URL 확인

`.env.local`의 `NEXT_PUBLIC_SUPABASE_URL`:

```
https://slnmhblsxzjgmaqbfbwa.supabase.co
```

→ project ref = `slnmhblsxzjgmaqbfbwa`

**SQL 실행 시**: Supabase Dashboard에서 동일 프로젝트(`slnmhblsxzjgmaqbfbwa`)를 선택했는지 확인.
