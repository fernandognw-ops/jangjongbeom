# 3단계: 정상 엑셀 재적재

## 전제 조건
- 01_backup_before_delete.sql 실행 완료
- 02_delete_bad_data.sql (또는 02b) 실행 완료
- **2026-03-18 07:00 기준 정상 수불 엑셀** 파일 준비

## 재적재 절차 (staging/dry-run → 승인 → 반영)

### 1) Dry-run으로 시뮬레이션 (필수)

```powershell
cd c:\Users\pc\inventory-system
python scripts/integrated_sync.py "경로/(수정양식)26년_0318_생산수불현황.xlsx" --dry-run
```

**확인 사항:**
- 입고/출고/재고 건수
- 재고 총합 금액 (엑셀 기준)
- 창고별(dest_warehouse) 분포

### 2) 결과 검토 후 실제 반영

dry-run 결과가 정상이면 `--dry-run` 없이 실행:

```powershell
python scripts/integrated_sync.py "경로/(수정양식)26년_0318_생산수불현황.xlsx"
```

또는 npm:

```powershell
npm run sync-excel -- "경로/엑셀파일.xlsx"
```

### 3) 웹 업로드와 동일한지 확인

- 로컬 sync-excel 실행 결과와 웹 엑셀 업로드 결과가 동일한 파서/규칙을 사용하는지 확인
- `common/parser.py` (로컬) ↔ `src/lib/excelParser/` (웹) 규칙 일치 여부
