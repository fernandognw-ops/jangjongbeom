-- ============================================================
-- 기존 products 테이블이 다른 구조로 있을 때 실행
-- Supabase SQL Editor에서 이 파일을 먼저 실행한 뒤
-- supabase-schema-inventory.sql 실행
-- ============================================================

-- 1. 기존 테이블 삭제 (순서: FK 참조하는 테이블 먼저)
DROP TABLE IF EXISTS inbound CASCADE;
DROP TABLE IF EXISTS outbound CASCADE;
DROP TABLE IF EXISTS stock_snapshot CASCADE;
DROP TABLE IF EXISTS logistics_cutoff_config CASCADE;
DROP TABLE IF EXISTS products CASCADE;

-- 2. ENUM 타입 삭제 (테이블 삭제 후)
DROP TYPE IF EXISTS sales_channel CASCADE;
