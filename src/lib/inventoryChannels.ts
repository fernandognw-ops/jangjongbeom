/**
 * 재고 판매채널 집계 — API·UI 단일 기준
 *
 * `inventory_stock_snapshot.dest_warehouse`: 엑셀 **「판매 채널」** →
 * `normalizeSalesChannelKr` → **"쿠팡" | "일반"** (보관센터명으로 추론하지 않음).
 *
 * `inventory_stock_snapshot.storage_center`: **보관/물류 센터** (실제 창고명).
 *
 * `sales_channel`: 엑셀 「판매 채널」 — 집계 시 **우선 사용**(`channelForSnapshotRow`). 신규 적재 시 `dest_warehouse`와 동일.
 */
export const WAREHOUSE_GENERAL = "일반" as const;
export const WAREHOUSE_COUPANG = "쿠팡" as const;

export type NormalizedWarehouse = typeof WAREHOUSE_GENERAL | typeof WAREHOUSE_COUPANG;

/**
 * 엑셀·DB `sales_channel` 문자열 → "쿠팡" | "일반" (보관센터 기반 추론 없음)
 */
export function normalizeSalesChannelKr(raw: string | null | undefined): NormalizedWarehouse {
  const base = String(raw ?? "").trim().toLowerCase();
  // 공백/구분자/특수문자 제거 후 키워드 포함 매칭
  const s = base.replace(/[\s\-_()[\]{}.,/\\:;'"`~!@#$%^&*+=?|<>]+/g, "");
  if (!s) return WAREHOUSE_GENERAL;
  if (
    s.includes("쿠팡") ||
    s.includes("coupang") ||
    s.includes("rocket") ||
    s.includes("로켓") ||
    s.includes("cp") ||
    s.includes("cpl") ||
    s.includes("fulfillment")
  ) {
    return WAREHOUSE_COUPANG;
  }
  return WAREHOUSE_GENERAL;
}

/**
 * @deprecated 재고 스냅샷 집계 금지 — `channelForSnapshotRow` + `normalizeSalesChannelKr`만 사용.
 * 입고/추세 등 레거시에서만: 센터명에 "테이칼튼" 포함 → 쿠팡으로 보는 규칙 (재고 시트와 무관)
 */
export function normalizeDestWarehouse(dest: string | null | undefined): NormalizedWarehouse {
  const s = String(dest ?? "").trim().replace(/\s/g, "").toLowerCase();
  if (!s) return WAREHOUSE_GENERAL;
  if (s === "쿠팡" || s.includes("테이칼튼") || s === "coupang") return WAREHOUSE_COUPANG;
  return WAREHOUSE_GENERAL;
}

/** 정규화된 판매채널이 쿠팡인지 */
export function isCoupangChannel(wh: string): boolean {
  return wh === WAREHOUSE_COUPANG;
}

/** @deprecated isCoupangChannel 사용 */
export function isCoupangNormalizedWarehouse(wh: string): boolean {
  return isCoupangChannel(wh);
}
