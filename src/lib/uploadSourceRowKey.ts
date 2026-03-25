/**
 * 업로드 원본행 단위 idempotency 키 (SHA-256).
 * 시트종류 | 기준일자 | sales_channel | product_code | 수량 | 금액 | 센터(보조)
 */
import { createHash } from "node:crypto";

export type UploadSheetKind = "inbound" | "outbound" | "snapshot";

function normCenter(s: string | null | undefined): string {
  return String(s ?? "").trim().replace(/\s+/g, " ");
}

function amountKey(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return n.toFixed(4);
}

export function buildUploadSourceRowKey(input: {
  sheet: UploadSheetKind;
  dateYmd: string;
  salesChannel: "coupang" | "general";
  productCode: string;
  quantity: number;
  amount: number;
  center: string;
}): string {
  const payload = [
    input.sheet,
    input.dateYmd,
    input.salesChannel,
    String(input.productCode).trim(),
    String(Math.trunc(Number(input.quantity) || 0)),
    amountKey(Number(input.amount) || 0),
    normCenter(input.center),
  ].join("|");
  return createHash("sha256").update(payload, "utf8").digest("hex");
}
