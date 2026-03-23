-- ============================================================
-- 월별 재고 자산(카테고리) 검증 — category-trend와 동일 규칙
-- Supabase SQL Editor
--
-- 운영 규칙: 한 달에는 최종적으로 snapshot_date가 1개만 남는 것이 정상(당월 재업로드 시 그 달 전체 교체).
-- §4: 여러 snapshot_date가 같은 달에 있으면 아직 정리 전이거나 수동 적재 혼선.
-- ============================================================

-- 범위: 차트와 맞추려면 아래 날짜를 조정 (기본 14개월 시작 ≈ 현재월-13개월 1일)
-- 예: 2025-02-01 이상 스냅샷만 대상

-- 1) snapshot_date별 row 수 / total_price 합
SELECT
  snapshot_date::date AS d,
  COUNT(*) AS row_count,
  SUM(COALESCE(total_price, 0)) AS sum_total_price
FROM inventory_stock_snapshot
WHERE snapshot_date >= '2025-02-01'
GROUP BY snapshot_date::date
ORDER BY d;

-- 2) 월별 마지막 snapshot_date (해당 월에 스냅샷이 있을 때만)
WITH days AS (
  SELECT DISTINCT snapshot_date::date AS d
  FROM inventory_stock_snapshot
  WHERE snapshot_date >= '2025-02-01'
),
by_month AS (
  SELECT
    to_char(d, 'YYYY-MM') AS month_key,
    MAX(d) AS last_snap
  FROM days
  GROUP BY to_char(d, 'YYYY-MM')
)
SELECT * FROM by_month ORDER BY month_key;

-- 3) 월별 마지막 스냅샷일 기준 카테고리별 total_price 합 (스냅샷 category 사용, 기타 제외 시 앱과 동일하려면 필터 추가)
WITH last_per_month AS (
  SELECT to_char(snapshot_date, 'YYYY-MM') AS month_key, MAX(snapshot_date::date) AS last_d
  FROM inventory_stock_snapshot
  WHERE snapshot_date >= '2025-02-01'
  GROUP BY to_char(snapshot_date, 'YYYY-MM')
)
SELECT
  l.month_key,
  l.last_d,
  COALESCE(NULLIF(TRIM(s.category), ''), '기타') AS category,
  SUM(COALESCE(s.total_price, 0)) AS sum_total_price,
  COUNT(*) AS rows
FROM last_per_month l
JOIN inventory_stock_snapshot s ON s.snapshot_date::date = l.last_d
GROUP BY l.month_key, l.last_d, COALESCE(NULLIF(TRIM(s.category), ''), '기타')
ORDER BY l.month_key, category;

-- 4) 운영 정상 여부: 달마다 snapshot_date 일자 종류가 1개인지 (2개 이상이면 월 단위 정리 전·수동 혼선 의심)
SELECT
  to_char(snapshot_date, 'YYYY-MM') AS month_key,
  COUNT(DISTINCT snapshot_date::date) AS distinct_snapshot_days
FROM inventory_stock_snapshot
WHERE snapshot_date >= '2025-02-01'
GROUP BY to_char(snapshot_date, 'YYYY-MM')
HAVING COUNT(DISTINCT snapshot_date::date) > 1
ORDER BY month_key;
-- 결과 0행 = 각 달에 스냅샷 일자 1종만 존재 (정상). 상세 일자는 §1로 확인.
