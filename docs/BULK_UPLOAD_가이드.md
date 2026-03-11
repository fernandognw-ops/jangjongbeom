# 1년치 생산수불 Bulk 업로드 가이드

## 1. 사전 준비: Supabase Unique 제약 추가

Bulk 업로드 전에 **Supabase SQL Editor**에서 아래 SQL을 실행하세요:

```sql
-- 입고: product_code + inbound_date (sales_channel 없음)
CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_upsert
  ON inventory_inbound (product_code, inbound_date);

-- 출고: product_code + outbound_date + sales_channel
CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_upsert
  ON inventory_outbound (product_code, outbound_date, sales_channel);
```

## 2. Bulk 업로드 실행

1. **개발 서버 실행** (다른 터미널):
   ```bash
   npm run dev
   ```

2. **Bulk 업로드 실행**:
   ```bash
   npm run bulk-upload "C:\Users\pc\Desktop\장종범\인수 인계서\물류 재고 관리 시스템 구축\수불 마감 자료"
   ```

   - 단일 파일: `npm run bulk-upload "경로/파일.xlsx"`
   - 폴더: 폴더 내 모든 `.xlsx` 파일을 병합 후 한 번에 업로드

## 3. 대시보드 확인

업로드 완료 후 `http://localhost:3000` 에서 1년치 차트를 확인하세요.
