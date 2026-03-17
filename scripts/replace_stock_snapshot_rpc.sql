-- ============================================================
-- 재고 스냅샷 전체 교체 RPC (트랜잭션 보장)
-- Supabase SQL Editor에서 실행하세요.
--
-- [필수] 생산수불현황 업로드 전 이 스크립트를 한 번 실행해야 합니다.
-- ============================================================
-- 1. 기존 데이터 전체 삭제 (DELETE)
-- 2. 신규 데이터 삽입 (INSERT) - ON CONFLICT 없음
-- 3. 한 트랜잭션으로 처리 (실패 시 전체 롤백)
-- ============================================================

CREATE OR REPLACE FUNCTION replace_stock_snapshot(p_rows JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  inserted_count INT := 0;
  elem JSONB;
  v_product_code TEXT;
  v_dest_warehouse TEXT;
  v_quantity INT;
  v_unit_cost NUMERIC;
  v_snapshot_date DATE;
BEGIN
  -- 1. 기존 데이터 전체 삭제
  DELETE FROM inventory_stock_snapshot;

  -- 2. 신규 데이터 삽입 (INSERT만)
  FOR elem IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_product_code := COALESCE((elem->>'product_code')::TEXT, '');
    v_dest_warehouse := COALESCE((elem->>'dest_warehouse')::TEXT, '');
    v_quantity := COALESCE((elem->>'quantity')::INTEGER, 0);
    v_unit_cost := COALESCE((elem->>'unit_cost')::NUMERIC, 0);
    v_snapshot_date := COALESCE((elem->>'snapshot_date')::DATE, CURRENT_DATE);

    IF v_product_code = '' THEN
      CONTINUE;
    END IF;

    INSERT INTO inventory_stock_snapshot (
      product_code,
      dest_warehouse,
      quantity,
      unit_cost,
      snapshot_date,
      total_price
    ) VALUES (
      v_product_code,
      v_dest_warehouse,
      v_quantity,
      v_unit_cost,
      v_snapshot_date,
      v_quantity * v_unit_cost
    );
    inserted_count := inserted_count + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'inserted', inserted_count);
EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION replace_stock_snapshot(JSONB) TO anon;
GRANT EXECUTE ON FUNCTION replace_stock_snapshot(JSONB) TO authenticated;

SELECT 'replace_stock_snapshot RPC 함수 생성 완료' AS status;
