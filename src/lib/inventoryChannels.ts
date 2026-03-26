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
export function normalizeSalesChannelKr(
  raw: unknown,
  options?: { lenient?: boolean }
): "쿠팡" | "일반" {
  const lenient = options?.lenient === true;
  const valueRaw = String(raw ?? "").trim();
  if (!valueRaw) {
    if (lenient) {
      console.warn("[normalizeSalesChannelKr] empty sales_channel → 일반 (lenient)");
      return WAREHOUSE_GENERAL;
    }
    throw new Error("sales_channel 값이 비어 있습니다.");
  }
  const lower = valueRaw.toLowerCase();

  // Excel 원문(KR) 우선
  if (valueRaw === "쿠팡") return "쿠팡";
  if (valueRaw === "일반") return "일반";

  // DB/레거시 호환(영문 lower-case)
  if (lower === "coupang") return "쿠팡";
  if (lower === "general") return "일반";

  if (lenient) {
    console.warn(`[normalizeSalesChannelKr] invalid sales_channel → 일반 (lenient): ${valueRaw}`);
    return WAREHOUSE_GENERAL;
  }
  throw new Error(`잘못된 sales_channel 값: ${valueRaw}`);
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
  return normalizeSalesChannelKr(picked, { lenient: true });
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
