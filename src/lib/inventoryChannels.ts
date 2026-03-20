/**
 * 재고 창고/채널 집계 — API·UI 단일 기준
 * - inventory_stock_snapshot.dest_warehouse 기준
 * - 쿠팡: "쿠팡", "coupang", "테이칼튼*" (legacy)
 * - 그 외·빈 값: "일반"
 *
 * 문자열 리터럴은 한 곳만 참조 (번들/비교 시 wh === "쿠팡" 불일치 방지)
 */
export const WAREHOUSE_GENERAL = "일반" as const;
export const WAREHOUSE_COUPANG = "쿠팡" as const;

export type NormalizedWarehouse = typeof WAREHOUSE_GENERAL | typeof WAREHOUSE_COUPANG;

export function normalizeDestWarehouse(dest: string | null | undefined): NormalizedWarehouse {
  const s = String(dest ?? "").trim().replace(/\s/g, "").toLowerCase();
  if (!s) return WAREHOUSE_GENERAL;
  if (s === "쿠팡" || s.includes("테이칼튼") || s === "coupang") return WAREHOUSE_COUPANG;
  return WAREHOUSE_GENERAL;
}

/** 정규화된 창고 키가 쿠팡인지 (stockByWarehouse[WAREHOUSE_COUPANG] 판별과 동일) */
export function isCoupangNormalizedWarehouse(wh: string): boolean {
  return wh === WAREHOUSE_COUPANG;
}
