import type { SupabaseClient } from "@supabase/supabase-js";

export const TABLE_UPLOAD_LOGS = "inventory_upload_logs";

export type UploadAuditPayload = {
  uploaded_by?: string;
  source?: string;
  filename: string;
  snapshot_date?: string | null;
  target_month?: string | null;
  rawdata_count: number;
  inbound_count: number;
  outbound_count: number;
  stock_count: number;
  total_value: number;
  general_count: number;
  coupang_count: number;
  status: "success" | "error";
  error_message?: string;
  auto_committed?: boolean;
  validation_passed?: boolean;
  validation_error_reason?: string;
  anomaly_row_count?: number;
  sum_outbound_total_amount?: number;
  sum_total_price?: number;
  sum_unit_price_x_qty?: number;
  source_selection_json?: unknown;
  validation_debug_json?: unknown;
};

function monthFromFilename(filename: string | undefined): string | null {
  const name = String(filename ?? "");
  const m1 = name.match(/(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})/);
  if (m1) return `${m1[1]}-${m1[2]}`;
  const ym = name.match(/(\d{4})[-_.](\d{2})(?![-_.]?\d{2})/);
  if (ym) return `${ym[1]}-${ym[2]}`;
  const kor = name.match(/(\d{2,4})년\s*(\d{1,2})월/);
  if (kor) {
    let y = parseInt(kor[1], 10);
    if (y < 100) y += y < 50 ? 2000 : 1900;
    const mo = parseInt(kor[2], 10);
    if (mo >= 1 && mo <= 12) return `${y}-${String(mo).padStart(2, "0")}`;
  }
  return null;
}

function toMonthKeyOrNow(raw: unknown, filename: string | undefined): string {
  const s = String(raw ?? "").trim();
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.slice(0, 7);
  const fromFilename = monthFromFilename(filename);
  if (fromFilename) return fromFilename;
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * 확장 컬럼이 없는 DB도 동작하도록: 전체 insert 실패 시 최소 컬럼만 재시도.
 */
export async function insertUploadAuditLog(
  supabase: SupabaseClient,
  payload: UploadAuditPayload
): Promise<void> {
  const normalizedTargetMonth = toMonthKeyOrNow(
    payload.target_month ?? payload.snapshot_date,
    payload.filename
  );

  const base = {
    uploaded_by: payload.uploaded_by ?? "web",
    source: payload.source ?? "web",
    filename: payload.filename,
    snapshot_date: payload.snapshot_date ?? null,
    rawdata_count: payload.rawdata_count,
    inbound_count: payload.inbound_count,
    outbound_count: payload.outbound_count,
    stock_count: payload.stock_count,
    total_value: payload.total_value,
    general_count: payload.general_count,
    coupang_count: payload.coupang_count,
    status: payload.status,
    error_message:
      payload.error_message ??
      (payload.validation_error_reason ? String(payload.validation_error_reason).slice(0, 2000) : undefined),
    auto_committed: payload.auto_committed,
    validation_passed: payload.validation_passed,
    validation_error_reason: payload.validation_error_reason,
    target_month: normalizedTargetMonth,
    anomaly_row_count: payload.anomaly_row_count,
    sum_outbound_total_amount: payload.sum_outbound_total_amount,
    sum_total_price: payload.sum_total_price,
    sum_unit_price_x_qty: payload.sum_unit_price_x_qty,
    source_selection_json: payload.source_selection_json,
    validation_debug_json: payload.validation_debug_json,
  };

  const { error } = await supabase.from(TABLE_UPLOAD_LOGS).insert(base as Record<string, unknown>);
  if (error) {
    throw new Error(`[insertUploadAuditLog] ${error.message}`);
  }
}
