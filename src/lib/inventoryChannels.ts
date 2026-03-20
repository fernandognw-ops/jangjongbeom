/**
 * 재고 창고/채널 집계 — API·UI 단일 기준
 * - inventory_stock_snapshot.dest_warehouse 기준
 * - 쿠팡: "쿠팡", "coupang", "테이칼튼*" (legacy)
 * - 그 외·빈 값: "일반"
 */
export type NormalizedWarehouse = "일반" | "쿠팡";

export function normalizeDestWarehouse(dest: string | null | undefined): NormalizedWarehouse {
  const s = String(dest ?? "").trim().replace(/\s/g, "").toLowerCase();
  if (!s) return "일반";
  if (s === "쿠팡" || s.includes("테이칼튼") || s === "coupang") return "쿠팡";
  return "일반";
}

/** 정규화된 창고 키가 쿠팡인지 (stockByWarehouse["쿠팡"] 판별과 동일) */
export function isCoupangNormalizedWarehouse(wh: string): boolean {
  return normalizeDestWarehouse(wh) === "쿠팡";
}
