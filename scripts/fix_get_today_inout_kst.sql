-- 기존 DB에만 적용: get_today_inout_count()를 한국(서울) 달력 기준으로 교체
-- 대시보드 "오늘 입고/출고"와 summary API가 UTC CURRENT_DATE로 하루가 밀리는 문제 방지

CREATE OR REPLACE FUNCTION get_today_inout_count()
RETURNS TABLE (
  inbound_count BIGINT,
  outbound_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT 
    (SELECT COUNT(*)::BIGINT FROM inventory_inbound
     WHERE inbound_date IS NOT NULL
       AND inbound_date::date = (current_timestamp AT TIME ZONE 'Asia/Seoul')::date),
    (SELECT COUNT(*)::BIGINT FROM inventory_outbound
     WHERE outbound_date IS NOT NULL
       AND outbound_date::date = (current_timestamp AT TIME ZONE 'Asia/Seoul')::date);
$$;
