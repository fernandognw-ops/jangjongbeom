-- inventory_sync 테이블 안전 삭제
-- Supabase 단일 출처 모드에서 화면 복원에 사용되지 않으므로 정리 가능
--
-- 실행 전 확인:
-- 1. npm run check-inventory-sync 로 현재 행 확인
-- 2. sync_code가 MAIN이 아닌 경우, 해당 연동코드를 사용하는 기기가 없는지 확인
--
-- Supabase SQL Editor에서 실행

-- 1) 현재 데이터 확인 (실행 전)
SELECT sync_code, updated_at, 
       jsonb_pretty(data::jsonb) IS NOT NULL AS has_data 
FROM inventory_sync 
ORDER BY updated_at DESC;

-- 2) 전체 삭제 (확정 후)
TRUNCATE inventory_sync;

-- 3) 삭제 결과 확인
SELECT COUNT(*) AS remaining FROM inventory_sync;
