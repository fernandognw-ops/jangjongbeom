/**
 * 출고 행 금액 선택 — 업로드 검증·대시보드 집계와 동일 우선순위.
 * category-trend `chosenOutboundAmount`와 동일 규칙(마스터 원가 맵만 주입 여부 차이).
 */

export type ChosenAmountSource =
  | "outbound_total_amount"
  | "total_price"
  | "unit_price_x_qty"
  | "master_unit_cost_x_qty"
  | "fallback_0";

export function parseMoney(v: unknown): number {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v).replace(/,/g, "").replace(/\s/g, "").trim();
  if (s === "") return 0;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

export function chosenOutboundAmount(
  row: {
    quantity?: unknown;
    outbound_total_amount?: unknown;
    total_price?: unknown;
    unit_price?: unknown;
  },
  codeKey: string,
  codeToCost: Map<string, number>
): { amount: number; source: ChosenAmountSource; suspectedUnitPrice: boolean } {
  const qty = Number(row.quantity ?? 0);
  const outboundTotalAmount = parseMoney(row.outbound_total_amount);
  const totalPrice = parseMoney(row.total_price);
  const unitPrice = parseMoney(row.unit_price);
  const masterUnitCost = Number(codeToCost.get(codeKey) ?? 0);

  if (outboundTotalAmount > 0) {
    return { amount: outboundTotalAmount, source: "outbound_total_amount", suspectedUnitPrice: false };
  }

  const normalizedQty = Number.isFinite(qty) ? qty : 0;
  const looksLikeUnitPriceInTotalCol =
    totalPrice > 0 &&
    normalizedQty > 1 &&
    ((unitPrice > 0 && Math.abs(totalPrice - unitPrice) < 0.0001) || totalPrice <= 1000);

  if (totalPrice > 0 && !looksLikeUnitPriceInTotalCol) {
    return { amount: totalPrice, source: "total_price", suspectedUnitPrice: false };
  }
  if (unitPrice > 0 && normalizedQty > 0) {
    return {
      amount: unitPrice * normalizedQty,
      source: "unit_price_x_qty",
      suspectedUnitPrice: looksLikeUnitPriceInTotalCol,
    };
  }
  if (masterUnitCost > 0 && normalizedQty > 0) {
    return {
      amount: masterUnitCost * normalizedQty,
      source: "master_unit_cost_x_qty",
      suspectedUnitPrice: looksLikeUnitPriceInTotalCol,
    };
  }
  return { amount: 0, source: "fallback_0", suspectedUnitPrice: looksLikeUnitPriceInTotalCol };
}
