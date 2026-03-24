/**
 * GET /api/inventory/upload-logs
 * 월별 업로드 검증 이력 (관리자용). Supabase anon + RLS로 읽기 허용 필요.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 200;
const DEFAULT_BOARD_FROM = "2025-05";
const DEFAULT_BOARD_TO = "2026-02";
const BASELINE_MONTH = process.env.UPLOAD_BASELINE_MONTH ?? "2025-05";

function parseMonthKey(ym: string): { y: number; m: number } | null {
  if (!/^\d{4}-\d{2}$/.test(ym)) return null;
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return null;
  return { y, m };
}

function enumerateMonths(fromYm: string, toYm: string): string[] {
  const from = parseMonthKey(fromYm);
  const to = parseMonthKey(toYm);
  if (!from || !to) return [];
  const months: string[] = [];
  let y = from.y;
  let m = from.m;
  while (y < to.y || (y === to.y && m <= to.m)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return months;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const month = searchParams.get("month")?.trim();
  const status = searchParams.get("status")?.trim();
  const boardFrom = searchParams.get("boardFrom")?.trim() || DEFAULT_BOARD_FROM;
  const boardTo = searchParams.get("boardTo")?.trim() || DEFAULT_BOARD_TO;
  const limit = Math.min(Math.max(Number(searchParams.get("limit")) || DEFAULT_LIMIT, 1), 500);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return NextResponse.json({ ok: false, error: "Supabase not configured" }, { status: 503 });
  }

  const supabase = createClient(url, key);
  let q = supabase
    .from("inventory_upload_logs")
    .select(
      "id,uploaded_at,uploaded_by,filename,target_month,snapshot_date,status,validation_passed,auto_committed,validation_error_reason,error_message,inbound_count,outbound_count,stock_count,rawdata_count,total_value,general_count,coupang_count,anomaly_row_count,sum_outbound_total_amount,sum_total_price,sum_unit_price_x_qty,source_selection_json,validation_debug_json"
    )
    .order("uploaded_at", { ascending: false })
    .limit(limit);

  if (month && /^\d{4}-\d{2}$/.test(month)) {
    q = q.eq("target_month", month);
  }
  if (status === "success") {
    q = q.eq("status", "success");
  } else if (status === "error") {
    q = q.eq("status", "error");
  }

  const { data, error } = await q;

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message, hint: "inventory_upload_logs 조회 실패. RLS SELECT 또는 스키마(alter_inventory_upload_logs_validation_audit.sql) 확인." },
      { status: 500 }
    );
  }

  const rows = data ?? [];
  const monthsNeedingReupload = new Set<string>();
  const monthLatest = new Map<
    string,
    {
      uploaded_at: string;
      status: string;
      validation_passed?: boolean | null;
      auto_committed?: boolean | null;
      validation_error_reason?: string | null;
      error_message?: string | null;
      filename?: string | null;
    }
  >();
  for (const r of rows as { target_month?: string | null; validation_passed?: boolean; status?: string }[]) {
    const ym = r.target_month;
    if (ym && (r.validation_passed === false || r.status === "error")) {
      monthsNeedingReupload.add(ym);
    }
  }
  for (const r of rows as Array<{
    target_month?: string | null;
    uploaded_at: string;
    status: string;
    validation_passed?: boolean | null;
    auto_committed?: boolean | null;
    validation_error_reason?: string | null;
    error_message?: string | null;
    filename?: string | null;
  }>) {
    const ym = r.target_month ?? "";
    if (!/^\d{4}-\d{2}$/.test(ym)) continue;
    if (!monthLatest.has(ym)) {
      monthLatest.set(ym, {
        uploaded_at: r.uploaded_at,
        status: r.status,
        validation_passed: r.validation_passed,
        auto_committed: r.auto_committed,
        validation_error_reason: r.validation_error_reason,
        error_message: r.error_message,
        filename: r.filename,
      });
    }
  }

  const boardMonths = enumerateMonths(boardFrom, boardTo);
  const baselineSucceeded = (() => {
    const b = monthLatest.get(BASELINE_MONTH);
    return !!(b && b.status === "success" && b.validation_passed === true && b.auto_committed === true);
  })();
  const monthBoard = boardMonths.map((ym) => {
    const latest = monthLatest.get(ym);
    const state = !latest ? "미업로드" : latest.status === "success" ? "정상" : "실패";
    return {
      month: ym,
      state,
      latestUploadedAt: latest?.uploaded_at ?? null,
      filename: latest?.filename ?? null,
      reason: latest?.validation_error_reason || latest?.error_message || null,
      isBaselineMonth: ym === BASELINE_MONTH,
      uploadEnabledByBaseline: ym === BASELINE_MONTH || baselineSucceeded,
    };
  });

  return NextResponse.json({
    ok: true,
    rows,
    meta: {
      monthsNeedingReupload: [...monthsNeedingReupload].sort(),
      limit,
      filters: { month: month || null, status: status || null },
      baselineMonth: BASELINE_MONTH,
      baselineSucceeded,
      boardFrom,
      boardTo,
      monthBoard,
    },
  });
}
