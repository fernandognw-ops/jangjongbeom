-- ============================================================
-- 재고 스냅샷 당월 데이터 교체 RPC (트랜잭션 보장)
-- Supabase SQL Editor에서 실행하세요.
--
-- [필수] 생산수불현황 업로드 전 이 스크립트를 한 번 실행해야 합니다.
-- ============================================================

-- 이전 버전 (전체 삭제) 함수 제거
DROP FUNCTION IF EXISTS replace_stock_snapshot(JSONB);
-- 1. 업로드 엑셀의 해당 월(예: 3월) 데이터만 삭제 (다른 달은 유지)
-- 2. 신규 데이터 삽입 (INSERT) - ON CONFLICT 없음
-- 3. 한 트랜잭션으로 처리 (실패 시 전체 롤백)
-- ============================================================

CREATE OR REPLACE FUNCTION replace_stock_snapshot(p_rows JSONB, p_snapshot_date TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  inserted_count INT := 0;
  elem JSONB;
  v_product_code TEXT;
  v_dest_warehouse TEXT;
  v_product_name TEXT;
  v_category TEXT;
  v_quantity INT;
  v_unit_cost NUMERIC;
  v_total_price NUMERIC;
  v_pack_size INT;
  v_snapshot_date DATE;
  v_target_date DATE;
  v_month_start DATE;
  v_next_month_start DATE;
BEGIN
  -- 업로드 데이터의 snapshot_date 기준 월 결정 (첫 행에서 추출, 없으면 CURRENT_DATE)
  IF p_snapshot_date IS NOT NULL AND p_snapshot_date != '' THEN
    v_target_date := p_snapshot_date::DATE;
  ELSIF jsonb_array_length(p_rows) > 0 THEN
    v_target_date := COALESCE(((p_rows->0)->>'snapshot_date')::DATE, CURRENT_DATE);
  ELSE
    v_target_date := CURRENT_DATE;
  END IF;

  -- 1. 해당 월의 기존 데이터만 삭제 (연도 포함한 날짜 범위, 다른 달/연도 데이터 미영향)
  v_month_start := date_trunc('month', v_target_date)::date;
  v_next_month_start := (date_trunc('month', v_target_date) + INTERVAL '1 month')::date;
  DELETE FROM inventory_stock_snapshot
  WHERE snapshot_date >= v_month_start
    AND snapshot_date < v_next_month_start;

  -- 2. 신규 데이터 삽입 (INSERT만)
  FOR elem IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_product_code := COALESCE((elem->>'product_code')::TEXT, '');
    v_dest_warehouse := COALESCE((elem->>'dest_warehouse')::TEXT, '');
    v_product_name := NULLIF(TRIM((elem->>'product_name')::TEXT), '');
    v_category := NULLIF(TRIM((elem->>'category')::TEXT), '');
    v_quantity := COALESCE((elem->>'quantity')::INTEGER, 0);
    v_unit_cost := COALESCE((elem->>'unit_cost')::NUMERIC, 0);
    v_snapshot_date := COALESCE((elem->>'snapshot_date')::DATE, CURRENT_DATE);

    IF v_product_code = '' THEN
      CONTINUE;
    END IF;

    -- total_price: 입력값 우선, 없으면 quantity * unit_cost (재고금액 vs 재고원가 구분)
    v_total_price := COALESCE((elem->>'total_price')::NUMERIC, 0);
    IF v_total_price <= 0 AND v_quantity > 0 THEN
      v_total_price := v_quantity * v_unit_cost;
    END IF;

    -- pack_size: 입수량 (SKU = quantity/pack_size). 0이면 1
    v_pack_size := COALESCE((elem->>'pack_size')::INTEGER, 0);
    IF v_pack_size <= 0 THEN
      v_pack_size := 1;
    END IF;

    INSERT INTO inventory_stock_snapshot (
      product_code,
      dest_warehouse,
      product_name,
      category,
      quantity,
      unit_cost,
      snapshot_date,
      total_price,
      pack_size
    ) VALUES (
      v_product_code,
      v_dest_warehouse,
      v_product_name,
      v_category,
      v_quantity,
      v_unit_cost,
      v_snapshot_date,
      v_total_price,
      v_pack_size
    );
    inserted_count := inserted_count + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'inserted', inserted_count);
EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION replace_stock_snapshot(JSONB, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION replace_stock_snapshot(JSONB, TEXT) TO authenticated;

SELECT 'replace_stock_snapshot RPC 함수 생성 완료 (당월만 삭제)' AS status;
