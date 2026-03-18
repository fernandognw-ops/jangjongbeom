/**
 * 센터명 → warehouse_group 분류 (common/classifier.py와 동일)
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

export function classifyWarehouseGroup(center: string): string {
  const c = normalizeValue(center);
  if (!c) return "일반";
  if (c.includes("테이칼튼")) return "쿠팡";
  return "일반";
}

export function toSalesChannel(center: string): "coupang" | "general" {
  const g = classifyWarehouseGroup(center);
  return g === "쿠팡" ? "coupang" : "general";
}
