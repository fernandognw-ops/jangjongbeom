-- ============================================================
-- Supabase Realtime용 id 컬럼 Primary Key 추가
-- Supabase SQL Editor에서 실행하세요.
--
-- Realtime 설정 시 Primary Key가 필요합니다.
-- inventory_stock_snapshot, inventory_raw_materials, inventory_boms
-- ============================================================

-- uuid 생성 함수 사용 (PostgreSQL 13+ 기본 제공)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 1. inventory_stock_snapshot
-- ============================================================
ALTER TABLE inventory_stock_snapshot ADD COLUMN IF NOT EXISTS id UUID;
UPDATE inventory_stock_snapshot SET id = gen_random_uuid() WHERE id IS NULL;
ALTER TABLE inventory_stock_snapshot ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE inventory_stock_snapshot ALTER COLUMN id SET NOT NULL;

ALTER TABLE inventory_stock_snapshot DROP CONSTRAINT IF EXISTS inventory_stock_snapshot_pkey;
ALTER TABLE inventory_stock_snapshot ADD CONSTRAINT inventory_stock_snapshot_pkey PRIMARY KEY (id);

SELECT 'inventory_stock_snapshot id PK 추가 완료' AS status;

-- ============================================================
-- 2. inventory_raw_materials (테이블 존재 시)
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory_raw_materials') THEN
    ALTER TABLE inventory_raw_materials ADD COLUMN IF NOT EXISTS id UUID;
    UPDATE inventory_raw_materials SET id = gen_random_uuid() WHERE id IS NULL;
    ALTER TABLE inventory_raw_materials ALTER COLUMN id SET DEFAULT gen_random_uuid();
    ALTER TABLE inventory_raw_materials ALTER COLUMN id SET NOT NULL;

    ALTER TABLE inventory_raw_materials DROP CONSTRAINT IF EXISTS inventory_raw_materials_pkey;
    ALTER TABLE inventory_raw_materials ADD CONSTRAINT inventory_raw_materials_pkey PRIMARY KEY (id);

    RAISE NOTICE 'inventory_raw_materials id PK 추가 완료';
  ELSE
    RAISE NOTICE 'inventory_raw_materials 테이블 없음 - 건너뜀';
  END IF;
END $$;

-- ============================================================
-- 3. inventory_boms (테이블 존재 시)
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory_boms') THEN
    ALTER TABLE inventory_boms ADD COLUMN IF NOT EXISTS id UUID;
    UPDATE inventory_boms SET id = gen_random_uuid() WHERE id IS NULL;
    ALTER TABLE inventory_boms ALTER COLUMN id SET DEFAULT gen_random_uuid();
    ALTER TABLE inventory_boms ALTER COLUMN id SET NOT NULL;

    ALTER TABLE inventory_boms DROP CONSTRAINT IF EXISTS inventory_boms_pkey;
    ALTER TABLE inventory_boms ADD CONSTRAINT inventory_boms_pkey PRIMARY KEY (id);

    RAISE NOTICE 'inventory_boms id PK 추가 완료';
  ELSE
    RAISE NOTICE 'inventory_boms 테이블 없음 - 건너뜀';
  END IF;
END $$;

SELECT 'Realtime용 id Primary Key 추가 완료' AS status;
