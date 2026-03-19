/**
 * 센터명/창고명/매출구분 → 판매채널 분류 (common/classifier.py와 동일)
 * dest_warehouse에는 "일반" 또는 "쿠팡"만 저장
 */

export function normalizeValue(val: string | number | null | undefined): string {
  if (val == null) return "";
  const s = String(val);
  if (s.toLowerCase() === "nan") return "";
  return s
    .replace(/\n/g, "")
    .replace(/\r/g, "")
    .replace(/\t/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** 원본 창고명/센터명/매출구분 → 판매채널 ("일반" | "쿠팡") */
export function toDestWarehouse(original: string | number | null | undefined): "일반" | "쿠팡" {
  const c = normalizeValue(original);
  if (!c) return "일반";
  if (c.includes("테이칼튼") || c.includes("쿠팡") || c.includes("coupang")) return "쿠팡";
  return "일반";
}

/** @deprecated classifyWarehouseGroup 대신 toDestWarehouse 사용 */
export function classifyWarehouseGroup(center: string): string {
  return toDestWarehouse(center);
}

/** sales_channel DB 저장용 (coupang | general) */
export function toSalesChannel(center: string): "coupang" | "general" {
  const g = toDestWarehouse(center);
  return g === "쿠팡" ? "coupang" : "general";
}
