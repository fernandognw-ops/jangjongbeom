/**
 * 재고·출고 판매채널 집계 — API·UI·SQL 동일 규칙
 *
 * - 출고(`inventory_outbound`) 채널 분리: **`sales_channel`만** (DB `channel` 컬럼·별칭 사용 금지)
 * - 정규화: `normalizeSalesChannelKr` = trim + lower 후 `coupang`/`general` 정확 일치만 허용
 * - 행 단위: `outboundChannelKrFromRow` — **`sales_channel`만** 읽음
 */

export const WAREHOUSE_GENERAL = "일반" as const;
export const WAREHOUSE_COUPANG = "쿠팡" as const;

export type NormalizedWarehouse = typeof WAREHOUSE_GENERAL | typeof WAREHOUSE_COUPANG;

/**
 * 엑셀·DB 값 → "쿠팡" | "일반" (대시보드·SQL·파서 공통)
 */
export function normalizeSalesChannelKr(raw: unknown): "쿠팡" | "일반" {
  const valueRaw = String(raw ?? "").trim();
  if (!valueRaw) return "일반";
  const value = valueRaw.toLowerCase();

  // English/숫자/공백/부분포함까지 허용 (엑셀 원문값 기준)
  if (value.includes("coupang") || valueRaw.includes("쿠팡")) return "쿠팡";
  if (value.includes("general") || valueRaw.includes("일반")) return "일반";

  // 알 수 없는 값은 안전하게 일반으로 처리(기본), 대신 업로드 시엔 sales_channel raw 기반 로그를 확인
  return "일반";
}

/** enum/json/object/number 등 → 비교용 문자열 (객체는 JSON.stringify) */
export function coerceOutboundSalesChannelValueToString(raw: unknown): string {
  if (raw == null) return "";
  const t = typeof raw;
  if (t === "string" || t === "number" || t === "boolean") return String(raw);
  if (t === "object") {
    try {
      return JSON.stringify(raw);
    } catch {
      return String(raw);
    }
  }
  return String(raw);
}

/**
 * 출고 행에서 판매채널 원문 추출 (sales_channel 단일)
 */
export function pickOutboundSalesChannelRawFromRow(row: Record<string, unknown>): string {
  const v = row["sales_channel"];
  if (v == null) return "";
  return coerceOutboundSalesChannelValueToString(v).trim();
}

/**
 * inventory_outbound(및 동형 객체) → 정규화 채널. **`channel` 컬럼은 읽지 않음**
 */
export function outboundChannelKrFromRow(row: Record<string, unknown>): NormalizedWarehouse {
  const picked = pickOutboundSalesChannelRawFromRow(row);
  return normalizeSalesChannelKr(picked);
}

/**
 * @deprecated 입고·추세 등 레거시: 센터명에 "테이칼튼" 포함 → 쿠팡 (출고 집계와 별도)
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
