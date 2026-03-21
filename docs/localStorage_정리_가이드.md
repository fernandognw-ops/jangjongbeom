# localStorage inventory-* 정리 가이드

## 1. 영향 여부

| 조건 | localStorage 영향 |
|------|-------------------|
| useSupabaseInventory = **true** (Supabase 데이터 사용) | **영향 없음** - API 응답만 사용 |
| useSupabaseInventory = **false** (로컬 모드) | **영향 있음** - baseStock, transactions, products 등 표시 |

### 영향 받는 경우
- API가 **empty_data** 또는 **fetch_error** 반환 → `useSupabaseInventory=false`로 전환
- 이때 `localDerived`가 `baseStock`, `transactions`, `products`, `dailyStock` 사용
- 해당 값들은 **localStorage**에서 로드 (`storage.loadBaseStock()` 등)

---

## 2. localStorage 키 목록

| 키 | 용도 |
|----|------|
| inventory-stock | 품목별 재고 (legacy) |
| inventory-base-stock | 기초 재고 |
| inventory-base-stock-by-product | 제품별 기초 재고 |
| inventory-daily-stock | 일별 재고 |
| inventory-transactions | 입출고 트랜잭션 |
| inventory-products | 제품 마스터 |
| inventory-sync-code | 연동코드 (sync용, 데이터 아님) |

---

## 3. 삭제 방법

### 방법 A: 브라우저 개발자 도구
1. F12 → 개발자 도구 열기
2. **Application** 탭 → **Local Storage** → 해당 사이트 선택
3. `inventory-`로 시작하는 키 선택 후 삭제
4. 페이지 새로고침

### 방법 B: 콘솔 실행
```javascript
// inventory-* 키만 삭제
Object.keys(localStorage)
  .filter(k => k.startsWith('inventory-'))
  .forEach(k => localStorage.removeItem(k));
location.reload();
```

### 방법 C: 연동코드만 유지하고 데이터만 삭제
```javascript
const syncCode = localStorage.getItem('inventory-sync-code');
Object.keys(localStorage)
  .filter(k => k.startsWith('inventory-') && k !== 'inventory-sync-code')
  .forEach(k => localStorage.removeItem(k));
if (syncCode) localStorage.setItem('inventory-sync-code', syncCode);
location.reload();
```

---

## 4. 삭제 후 확인
- Supabase에 데이터가 있으면: 새로고침 시 API에서 0건 또는 실제 데이터 로드
- Supabase가 비어 있으면: `empty_data` → 0건 표시
