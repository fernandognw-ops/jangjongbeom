/**
 * 웹 UI 업로드: 파싱 → 자동 검증 → 통과 시에만 commit + 감사 로그
 * POST /api/production-sheet-validate
 */

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseProductionSheetFromBuffer } from "@/lib/productionSheetParser";
import { toDestWarehouse } from "@/lib/excelParser/classifier";
import { normalizeSalesChannelKr } from "@/lib/inventoryChannels";
import { commitProductionSheet, type CommitInput } from "@/lib/commitProductionSheet";
import { validateSnapshotDatesAgainstFilename } from "@/lib/snapshotUploadValidation";
import { validateOutboundDatesForFilenameMonth } from "@/lib/outboundUploadValidation";
import { defaultDateFromFilename } from "@/lib/excelParser/parser";
import { runUploadAutoValidation } from "@/lib/uploadAutoValidation";
import { insertUploadAuditLog } from "@/lib/uploadLogWriter";

const VALID_DEST_WAREHOUSES = ["일반", "쿠팡"];
const VALIDATE_SERVER_MARKER = "validate-v3-auto-audit-2026-03-24";
const BASELINE_MONTH = process.env.UPLOAD_BASELINE_MONTH ?? "2025-05";

function monthFromYmd(ymd: string | null | undefined): string | null {
  const s = String(ymd ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s.slice(0, 7);
}

function resolveTargetMonth(params: {
  autoTargetMonth?: string | null;
  filenameExpectedMonth?: string | null;
  outboundDates?: string[];
  snapshotDates?: string[];
  inboundDates?: string[];
}): string {
  const candidates = [
    params.autoTargetMonth,
    params.filenameExpectedMonth,
    monthFromYmd(params.outboundDates?.[0]),
    monthFromYmd(params.snapshotDates?.[0]),
    monthFromYmd(params.inboundDates?.[0]),
  ].filter((v): v is string => !!v && /^\d{4}-\d{2}$/.test(v));
  if (candidates.length > 0) return candidates[0];
  return "unknown";
}

async function hasBaselineSuccess(supabase: SupabaseClient, baselineMonth: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("inventory_upload_logs")
    .select("id")
    .eq("target_month", baselineMonth)
    .eq("status", "success")
    .eq("validation_passed", true)
    .eq("auto_committed", true)
    .limit(1);
  if (error) {
    console.warn("[production-sheet-validate] baseline check failed:", error.message);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

async function logUploadAudit(
  supabase: SupabaseClient | null,
  params: {
    filename: string;
    validation: Record<string, unknown>;
    validation_passed: boolean;
    auto_committed: boolean;
    error_message: string;
  }
) {
  if (!supabase) return;
  const v = params.validation;
  const auto = v.autoValidation as
    | {
        targetMonthKey?: string | null;
        anomalyRowCount?: number;
        sums?: { sumOutboundTotalAmountField: number; sumTotalPrice: number; sumUnitPriceXQty: number };
        sourceSelection?: unknown;
        blockReasons?: string[];
      }
    | undefined;
  const targetMonth = resolveTargetMonth({
    autoTargetMonth: auto?.targetMonthKey ?? null,
    filenameExpectedMonth: (v.filenameExpectedMonth as string | undefined) ?? null,
    outboundDates: (v.outboundDates as string[] | undefined) ?? [],
    snapshotDates: (v.snapshotDates as string[] | undefined) ?? [],
  });
  await insertUploadAuditLog(supabase, {
    filename: params.filename,
    snapshot_date: (v.snapshotDates as string[] | undefined)?.[0] ?? null,
    target_month: targetMonth,
    rawdata_count: Number(v.rawdataCount) || 0,
    inbound_count: Number(v.inboundCount) || 0,
    outbound_count: Number(v.outboundCount) || 0,
    stock_count: Number(v.stockCount) || 0,
    total_value: Number(v.totalStockValue) || 0,
    general_count: (v.destWarehouseDistribution as Record<string, number> | undefined)?.["일반"] ?? 0,
    coupang_count: (v.destWarehouseDistribution as Record<string, number> | undefined)?.["쿠팡"] ?? 0,
    status: params.validation_passed && params.auto_committed ? "success" : "error",
    validation_passed: params.validation_passed,
    auto_committed: params.auto_committed,
    validation_error_reason: params.error_message,
    error_message: params.error_message,
    anomaly_row_count: auto?.anomalyRowCount,
    sum_outbound_total_amount: auto?.sums?.sumOutboundTotalAmountField,
    sum_total_price: auto?.sums?.sumTotalPrice,
    sum_unit_price_x_qty: auto?.sums?.sumUnitPriceXQty,
    source_selection_json: auto?.sourceSelection,
    validation_debug_json: {
      marker: VALIDATE_SERVER_MARKER,
      uploadPeriodValid: v.uploadPeriodValid,
      snapshotDateValid: v.snapshotDateValid,
      outboundDatePeriodValid: v.outboundDatePeriodValid,
      blockReasons: auto?.blockReasons,
    },
  });
}

function ensureDestWarehouse(wh: string | undefined | null): string {
  const s = String(wh ?? "").trim();
  if (!s) return "일반";
  return toDestWarehouse(s);
}

function validateDestWarehouse(wh: string): boolean {
  const normalized = ensureDestWarehouse(wh);
  return VALID_DEST_WAREHOUSES.includes(normalized);
}

function hasCoupangHint(raw: string | null | undefined): boolean {
  const s = String(raw ?? "").toLowerCase();
  const compact = s.replace(/[\s\-_()[\]{}.,/\\:;'"`~!@#$%^&*+=?|<>]+/g, "");
  return (
    compact.includes("쿠팡") ||
    compact.includes("coupang") ||
    compact.includes("rocket") ||
    compact.includes("로켓") ||
    compact.includes("cp") ||
    compact.includes("cpl") ||
    compact.includes("fulfillment")
  );
}

export async function POST(request: Request) {
  try {
    const serverInfo = {
      marker: VALIDATE_SERVER_MARKER,
      commit: process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || "",
      branch: process.env.VERCEL_GIT_COMMIT_REF || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF || "",
      env: process.env.VERCEL_ENV || process.env.NODE_ENV || "",
      ts: new Date().toISOString(),
    };

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "파일이 없습니다.", serverInfo }, { status: 400 });
    }

    const buf = await file.arrayBuffer();
    const result = await parseProductionSheetFromBuffer(buf, file.name);

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.message, missingSheets: result.missingSheets, serverInfo },
        { status: 400 }
      );
    }

    const {
      inbound,
      outbound,
      stockSnapshot,
      rawdata,
      currentProductCodes,
      stockSalesChannelColumnFound,
      stockDateDiagnostics,
      outboundDateDiagnostics,
      outboundRawRowCount,
    } = result;

    if (inbound.length === 0 && outbound.length === 0 && stockSnapshot.length === 0) {
      return NextResponse.json(
        { ok: false, error: "입고·출고·재고 시트에서 유효한 데이터를 찾을 수 없습니다." },
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const supabaseForLog = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

    const invalidWh: string[] = [];
    for (const r of inbound) {
      const wh = r.dest_warehouse ?? "일반";
      if (!validateDestWarehouse(wh)) invalidWh.push(`입고: ${wh}`);
    }
    for (const r of outbound) {
      // 출고는 dest_warehouse=출고센터로 사용, 채널 검증은 sales_channel만 사용
      const wh = normalizeSalesChannelKr(r.sales_channel === "coupang" ? "쿠팡" : "일반");
      if (!validateDestWarehouse(wh)) invalidWh.push(`출고: ${wh}`);
    }
    // 재고: dest_warehouse = 판매채널(쿠팡|일반), storage_center = 보관센터 — 엑셀 컬럼 그대로
    const uniqueInvalid = [...new Set(invalidWh)];
    const destWarehouseValid = uniqueInvalid.length === 0;

    const whCountInbound: Record<string, number> = { 일반: 0, 쿠팡: 0 };
    const whCountOutbound: Record<string, number> = { 일반: 0, 쿠팡: 0 };
    const whCountStock: Record<string, number> = { 일반: 0, 쿠팡: 0 };
    for (const r of inbound) {
      const wh = ensureDestWarehouse(r.dest_warehouse);
      whCountInbound[wh] = (whCountInbound[wh] ?? 0) + 1;
    }
    for (const r of outbound) {
      const wh = normalizeSalesChannelKr(r.sales_channel === "coupang" ? "쿠팡" : "일반");
      whCountOutbound[wh] = (whCountOutbound[wh] ?? 0) + 1;
    }
    for (const r of stockSnapshot) {
      const ch = normalizeSalesChannelKr(r.dest_warehouse ?? "");
      whCountStock[ch] = (whCountStock[ch] ?? 0) + 1;
    }
    const whCountTotal = {
      일반: (whCountInbound["일반"] ?? 0) + (whCountOutbound["일반"] ?? 0) + (whCountStock["일반"] ?? 0),
      쿠팡: (whCountInbound["쿠팡"] ?? 0) + (whCountOutbound["쿠팡"] ?? 0) + (whCountStock["쿠팡"] ?? 0),
    };

    const totalStockValue = stockSnapshot.reduce((sum, r) => sum + (r.quantity ?? 0) * (r.unit_cost ?? 0), 0);
    const snapshotDates = [...new Set(stockSnapshot.map((r) => r.snapshot_date ?? "").filter(Boolean))].sort();

    const snapVal = validateSnapshotDatesAgainstFilename(file.name, stockSnapshot, {
      stockDateColumnFound: stockDateDiagnostics?.stockDateColumnFound,
    });
    const outVal = validateOutboundDatesForFilenameMonth(file.name, outbound);
    const todayStr = new Date().toISOString().slice(0, 10);
    const allSnapshotAreToday =
      stockSnapshot.length > 0 &&
      snapshotDates.length > 0 &&
      snapshotDates.every((d) => d === todayStr);

    const outboundParsedCount = outbound.length;

    const outboundDates = outVal.outboundDates;

    const outboundChannelBreakdown: Record<string, number> = { 일반: 0, 쿠팡: 0 };
    for (const r of outbound) {
      const ch = normalizeSalesChannelKr(r.sales_channel === "coupang" ? "쿠팡" : "일반");
      outboundChannelBreakdown[ch] = (outboundChannelBreakdown[ch] ?? 0) + (r.quantity ?? 0);
    }

    const outboundSalesChannelOk = outboundDateDiagnostics?.outboundSalesChannelColumnFound !== false;
    const outboundTotalAmountColumnFound = outboundDateDiagnostics?.outboundTotalAmountColumnFound !== false;
    const outboundSalesChannelDistinctRaw = outboundDateDiagnostics?.outboundSalesChannelDistinctRaw ?? [];
    const outboundSalesChannelClassifiedRaw = {
      coupang: outboundSalesChannelDistinctRaw.filter((v) => normalizeSalesChannelKr(v) === "쿠팡"),
      general: outboundSalesChannelDistinctRaw.filter((v) => normalizeSalesChannelKr(v) === "일반"),
    };
    const outboundSalesChannelGeneralWithCoupangHint =
      outboundSalesChannelClassifiedRaw.general.filter((v) => hasCoupangHint(v));
    const outboundTotalAmountSamples = outboundDateDiagnostics?.outboundTotalAmountSamples ?? [];
    const outboundSumTotalAmountParsed = outbound.reduce((s, r) => s + (Number(r.total_price) || 0), 0);
    const outboundSumUnitPriceXQty = outbound.reduce((s, r) => s + (Number(r.unit_price) || 0) * (Number(r.quantity) || 0), 0);
    const outboundAvgTotalAmount = outbound.length > 0 ? outboundSumTotalAmountParsed / outbound.length : 0;
    const outboundAmountRatioUnitOverTotal =
      outboundSumTotalAmountParsed > 0 ? outboundSumUnitPriceXQty / outboundSumTotalAmountParsed : null;

    const autoValidation = runUploadAutoValidation({
      filename: file.name,
      inbound,
      outbound,
      stockSnapshot,
      outboundDateDiagnostics,
      outboundMonthValidation: outVal,
      outboundRawRowCount,
    });

    const validation = {
      rawdataCount: rawdata?.length > 0 ? rawdata.length : currentProductCodes.length,
      inboundCount: inbound.length,
      outboundCount: outbound.length,
      outboundParsedCount,
      /** 출고 고유 일자·합계(파일명 기대 월 대비 검증 포함) */
      outboundDates,
      outboundTotalQty: outVal.outboundTotalQty,
      outboundTotalAmountExcel: outVal.outboundTotalAmountExcel,
      outboundDatePeriodValid: outVal.outboundDatePeriodValid,
      outboundOutsideMonthCount: outVal.outboundOutsideMonthCount,
      outboundOutsideMonthRatio: outVal.outboundOutsideMonthRatio,
      outboundDateMismatchReason: outVal.outboundDateMismatchReason,
      outboundDateColumnFound: outboundDateDiagnostics?.outboundDateColumnFound ?? true,
      outboundDateColumnHeader: outboundDateDiagnostics?.outboundDateColumnHeader ?? "",
      outboundSalesChannelColumnFound: outboundDateDiagnostics?.outboundSalesChannelColumnFound ?? true,
      outboundSalesChannelColumnHeader: outboundDateDiagnostics?.outboundSalesChannelColumnHeader ?? "",
      outboundSalesChannelDistinctRaw,
      outboundSalesChannelDistinctTrimmed: outboundDateDiagnostics?.outboundSalesChannelDistinctTrimmed ?? [],
      outboundSalesChannelSamples: outboundDateDiagnostics?.outboundSalesChannelSamples?.slice(0, 20) ?? [],
      outboundTotalAmountColumnFound,
      outboundTotalAmountColumnHeader: outboundDateDiagnostics?.outboundTotalAmountColumnHeader ?? "",
      outboundTotalAmountSamples: outboundTotalAmountSamples.slice(0, 20),
      outboundSumTotalAmountParsed,
      outboundSumUnitPriceXQty,
      outboundAvgTotalAmount,
      outboundAmountRatioUnitOverTotal,
      outboundSalesChannelClassifiedRaw,
      outboundSalesChannelGeneralWithCoupangHint,
      outboundChannelBreakdown,
      outboundRawRowCount: outboundRawRowCount ?? 0,
      stockCount: stockSnapshot.length,
      totalStockValue,
      destWarehouseDistribution: whCountTotal,
      destWarehouseBySource: { inbound: whCountInbound, outbound: whCountOutbound, stock: whCountStock },
      snapshotDates,
      destWarehouseValid,
      invalidDestWarehouses: uniqueInvalid,
      snapshotDateValid: snapVal.snapshotDateValid,
      filenameHasDatePattern: snapVal.filenameHasDatePattern,
      filenameExpectedDate: snapVal.filenameExpectedDate,
      filenameExpectedMonth: snapVal.filenameExpectedMonth,
      snapshotDateMismatchReason: snapVal.snapshotDateMismatchReason,
      /** 파일명에 날짜 힌트 없고 snapshot이 전부 오늘 — 과거 파일 오인 가능 */
      snapshotLooksLikeServerTodayOnly: !snapVal.filenameHasDatePattern && allSnapshotAreToday && stockSnapshot.length > 0,
      stockDateColumnFound: stockDateDiagnostics?.stockDateColumnFound ?? true,
      stockDateColumnHeader: stockDateDiagnostics?.stockDateColumnHeader ?? "",
      /** 자동 검증 리포트 + 기간·채널 게이트 (commit 조건) */
      autoValidation,
      uploadPeriodValid:
        snapVal.snapshotDateValid &&
        outVal.outboundDatePeriodValid &&
        outboundSalesChannelOk &&
        autoValidation.blockReasons.length === 0,
    };

    const validationErrorReasons: string[] = [];
    if (validation.outboundDatePeriodValid !== true) validationErrorReasons.push("outboundDatePeriodValid=false");
    if ((validation.outboundSalesChannelGeneralWithCoupangHint?.length ?? 0) > 0) {
      validationErrorReasons.push("outboundSalesChannelGeneralWithCoupangHint not empty");
    }
    if (!destWarehouseValid) {
      validationErrorReasons.push(`dest_warehouse invalid: ${uniqueInvalid.join(", ")}`);
    }
    validationErrorReasons.push(...autoValidation.blockReasons);

    const validationPassed = validationErrorReasons.length === 0;
    const validationErrorReason = validationErrorReasons.join(" | ");

    console.log(
      "[production-sheet-validate]",
      JSON.stringify({
        filename: file.name,
        snapshotDates: validation.snapshotDates,
        snapshotDateValid: validation.snapshotDateValid,
        filenameExpectedMonth: validation.filenameExpectedMonth,
        snapshotDateMismatchReason: validation.snapshotDateMismatchReason,
        snapshotLooksLikeServerTodayOnly: validation.snapshotLooksLikeServerTodayOnly,
        stockDateColumnFound: validation.stockDateColumnFound,
        stockDateColumnHeader: validation.stockDateColumnHeader,
        stockDateDiagnosticsSample: stockDateDiagnostics?.samples?.slice(0, 5),
        outboundDates: validation.outboundDates,
        outboundDatePeriodValid: validation.outboundDatePeriodValid,
        outboundCount: validation.outboundCount,
        outboundTotalQty: validation.outboundTotalQty,
        outboundTotalAmountExcel: validation.outboundTotalAmountExcel,
        outboundOutsideMonthCount: validation.outboundOutsideMonthCount,
        outboundDateMismatchReason: validation.outboundDateMismatchReason,
        outboundDateColumnHeader: validation.outboundDateColumnHeader,
        outboundDateDiagnosticsSample: outboundDateDiagnostics?.samples?.slice(0, 5),
        outboundSalesChannelColumnFound: validation.outboundSalesChannelColumnFound,
        outboundSalesChannelColumnHeader: validation.outboundSalesChannelColumnHeader,
        outboundSalesChannelDistinctRaw: validation.outboundSalesChannelDistinctRaw,
        outboundSalesChannelDistinctTrimmed: validation.outboundSalesChannelDistinctTrimmed,
        outboundSalesChannelSamples: validation.outboundSalesChannelSamples,
        outboundTotalAmountColumnFound: validation.outboundTotalAmountColumnFound,
        outboundTotalAmountColumnHeader: validation.outboundTotalAmountColumnHeader,
        outboundTotalAmountSamples: validation.outboundTotalAmountSamples,
        outboundSumTotalAmountParsed: validation.outboundSumTotalAmountParsed,
        outboundSumUnitPriceXQty: validation.outboundSumUnitPriceXQty,
        outboundAvgTotalAmount: validation.outboundAvgTotalAmount,
        outboundAmountRatioUnitOverTotal: validation.outboundAmountRatioUnitOverTotal,
        outboundSalesChannelClassifiedRaw: validation.outboundSalesChannelClassifiedRaw,
        outboundSalesChannelGeneralWithCoupangHint: validation.outboundSalesChannelGeneralWithCoupangHint,
        outboundChannelBreakdown: validation.outboundChannelBreakdown,
        validateServerInfo: serverInfo,
        uploadPeriodValid: validation.uploadPeriodValid,
      })
    );

    if (outboundDateDiagnostics?.outboundSalesChannelColumnFound === false) {
      const err =
        '출고 시트에서 「판매 채널」열을 찾을 수 없습니다. 헤더를 "판매 채널", "판매채널", "판매 채널명" 중 하나로 맞추세요. (매출구분 열은 사용하지 않습니다.)';
      await logUploadAudit(supabaseForLog, {
        filename: file.name,
        validation: validation as Record<string, unknown>,
        validation_passed: false,
        auto_committed: false,
        error_message: err,
      });
      return NextResponse.json(
        {
          ok: false,
          blocked: true,
          error: err,
          validation,
          serverInfo,
          stockDateDiagnostics,
          outboundDateDiagnostics,
        },
        { status: 400 }
      );
    }

    if (stockSnapshot.length > 0 && !snapVal.snapshotDateValid) {
      const err = snapVal.snapshotDateMismatchReason ?? "재고 snapshot_date 검증 실패";
      await logUploadAudit(supabaseForLog, {
        filename: file.name,
        validation: validation as Record<string, unknown>,
        validation_passed: false,
        auto_committed: false,
        error_message: err,
      });
      return NextResponse.json(
        {
          ok: false,
          blocked: true,
          error: err,
          validation,
          serverInfo,
          stockDateDiagnostics,
          outboundDateDiagnostics,
        },
        { status: 400 }
      );
    }

    if (outbound.length > 0 && !outVal.outboundDatePeriodValid) {
      const err = outVal.outboundDateMismatchReason ?? "출고 outbound_date 월 검증 실패";
      await logUploadAudit(supabaseForLog, {
        filename: file.name,
        validation: validation as Record<string, unknown>,
        validation_passed: false,
        auto_committed: false,
        error_message: err,
      });
      return NextResponse.json(
        {
          ok: false,
          blocked: true,
          error: err,
          validation,
          serverInfo,
          stockDateDiagnostics,
          outboundDateDiagnostics,
        },
        { status: 400 }
      );
    }

    const outboundLost =
      (outboundRawRowCount ?? 0) > 5 &&
      outbound.length === 0 &&
      outboundDateDiagnostics?.outboundDateColumnFound === false;
    if (outboundLost) {
      const err =
        "출고 시트에 원본 행이 있는데 출고일 열을 찾지 못했거나 유효 행이 0건입니다. 출고일·품번 열을 확인하세요.";
      await logUploadAudit(supabaseForLog, {
        filename: file.name,
        validation: validation as Record<string, unknown>,
        validation_passed: false,
        auto_committed: false,
        error_message: err,
      });
      return NextResponse.json(
        {
          ok: false,
          blocked: true,
          error: err,
          validation,
          serverInfo,
          stockDateDiagnostics,
          outboundDateDiagnostics,
        },
        { status: 400 }
      );
    }

    const warnings: string[] = [];
    if (stockSnapshot.length > 0 && stockSalesChannelColumnFound === false) {
      warnings.push(
        "재고 시트에서 「판매 채널」 헤더를 찾지 못했습니다. 파싱된 채널은 모두 「일반」으로만 채워집니다. 헤더를 '판매 채널' 또는 '판매채널' 등으로 맞추거나 docs/재고_판매채널_컬럼.md를 확인하세요."
      );
    }
    if (stockSnapshot.length > 0 && !defaultDateFromFilename(file.name)) {
      warnings.push(
        "파일명에 YYYY-MM-DD·YYYYMMDD·YYYY-MM·○년○월 형식 날짜가 없습니다. 재고 시트 「기준일자」열에 과거 일자가 들어가 있는지 반드시 확인하세요. (비어 있으면 서버 오늘 날짜로 채워질 수 있습니다.)"
      );
    }
    if (stockSnapshot.length > 0 && validation.snapshotLooksLikeServerTodayOnly) {
      warnings.push(
        `재고 snapshot_date가 모두 오늘(${todayStr})입니다. 과거 자료라면 시트 기준일 열·파일명 날짜를 점검하세요.`
      );
    }
    if (validation.filenameExpectedMonth) {
      warnings.push(
        `동일 월(${validation.filenameExpectedMonth}) 재업로드 시 기존 해당 월 데이터는 자동 교체됩니다.`
      );
    }

    if (!validationPassed) {
      await logUploadAudit(supabaseForLog, {
        filename: file.name,
        validation: validation as Record<string, unknown>,
        validation_passed: false,
        auto_committed: false,
        error_message: validationErrorReason,
      });
      return NextResponse.json(
        {
          ok: false,
          blocked: true,
          error: `자동 반영 차단: ${validationErrorReason}`,
          validation,
          serverInfo,
          autoCommit: {
            executed: false,
            validation_passed: false,
            validation_error_reason: validationErrorReason,
          },
          warnings: warnings.length ? warnings : undefined,
        },
        { status: 400 }
      );
    }

    if (!supabaseForLog) {
      return NextResponse.json({ ok: false, error: "Supabase not configured", validation, serverInfo }, { status: 503 });
    }
    const supabase = supabaseForLog;

    const uploadMonth =
      resolveTargetMonth({
        autoTargetMonth: (validation.autoValidation?.targetMonthKey as string | undefined) ?? null,
        filenameExpectedMonth: (validation.filenameExpectedMonth as string | undefined) ?? null,
        outboundDates: (validation.outboundDates as string[] | undefined) ?? [],
        snapshotDates: (validation.snapshotDates as string[] | undefined) ?? [],
        inboundDates: inbound.map((r) => r.inbound_date),
      }) || null;
    if (uploadMonth && uploadMonth !== BASELINE_MONTH) {
      const baselineOk = await hasBaselineSuccess(supabase, BASELINE_MONTH);
      if (!baselineOk) {
        const baselineErr = `기준 월(${BASELINE_MONTH}) 업로드·검증·반영 성공 이력이 없어 ${uploadMonth} 반영을 차단합니다. 먼저 ${BASELINE_MONTH}를 정상 업로드하세요.`;
        await logUploadAudit(supabaseForLog, {
          filename: file.name,
          validation: validation as Record<string, unknown>,
          validation_passed: false,
          auto_committed: false,
          error_message: baselineErr,
        });
        return NextResponse.json(
          {
            ok: false,
            blocked: true,
            error: baselineErr,
            validation,
            serverInfo,
            autoCommit: {
              executed: false,
              validation_passed: false,
              validation_error_reason: baselineErr,
            },
          },
          { status: 400 }
        );
      }
    }

    const input: CommitInput = {
      filename: file.name,
      inbound,
      outbound,
      stockSnapshot,
      rawdata: rawdata ?? [],
      currentProductCodes,
    };

    try {
      const result = await commitProductionSheet(supabase, input, (table, rows) => {
        console.log(`[DB_WRITE] source=web table=${table} rows=${rows} ts=${new Date().toISOString()}`);
      });

      const whDist = validation.destWarehouseDistribution ?? { 일반: 0, 쿠팡: 0 };
      const snapshotDate = validation.snapshotDates?.[0] ?? null;
      const auto = validation.autoValidation;
      const targetMonth = resolveTargetMonth({
        autoTargetMonth: auto?.targetMonthKey ?? null,
        filenameExpectedMonth: validation.filenameExpectedMonth ?? null,
        outboundDates: validation.outboundDates ?? [],
        snapshotDates: validation.snapshotDates ?? [],
        inboundDates: inbound.map((r) => r.inbound_date),
      });
      await insertUploadAuditLog(supabase, {
        uploaded_by: "web",
        source: "web",
        filename: file.name,
        snapshot_date: snapshotDate,
        target_month: targetMonth,
        rawdata_count: validation.rawdataCount,
        inbound_count: result.inboundInserted,
        outbound_count: result.outboundInserted,
        stock_count: result.stockSnapshotCount,
        total_value: validation.totalStockValue,
        general_count: whDist["일반"] ?? 0,
        coupang_count: whDist["쿠팡"] ?? 0,
        status: "success",
        validation_passed: true,
        auto_committed: true,
        validation_error_reason: "",
        anomaly_row_count: auto?.anomalyRowCount,
        sum_outbound_total_amount: auto?.sums.sumOutboundTotalAmountField,
        sum_total_price: auto?.sums.sumTotalPrice,
        sum_unit_price_x_qty: auto?.sums.sumUnitPriceXQty,
        source_selection_json: auto?.sourceSelection,
        validation_debug_json: {
          marker: VALIDATE_SERVER_MARKER,
          commit: { inboundInserted: result.inboundInserted, outboundInserted: result.outboundInserted, stock: result.stockSnapshotCount },
        },
      });

      try {
        revalidatePath("/");
      } catch {
        // ignore
      }

      return NextResponse.json({
        ok: true,
        validation,
        serverInfo,
        warnings: warnings.length ? warnings : undefined,
        autoCommit: {
          executed: true,
          validation_passed: true,
          validation_error_reason: "",
          result: {
            inboundInserted: result.inboundInserted,
            outboundInserted: result.outboundInserted,
            stockSnapshotCount: result.stockSnapshotCount,
            currentProducts: result.currentProducts,
          },
        },
      });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "Unknown error";
      const whDist = validation.destWarehouseDistribution ?? { 일반: 0, 쿠팡: 0 };
      const snapshotDate = validation.snapshotDates?.[0] ?? null;
      const auto = validation.autoValidation;
      const targetMonth = resolveTargetMonth({
        autoTargetMonth: auto?.targetMonthKey ?? null,
        filenameExpectedMonth: validation.filenameExpectedMonth ?? null,
        outboundDates: validation.outboundDates ?? [],
        snapshotDates: validation.snapshotDates ?? [],
        inboundDates: inbound.map((r) => r.inbound_date),
      });
      await insertUploadAuditLog(supabase, {
        uploaded_by: "web",
        source: "web",
        filename: file.name,
        snapshot_date: snapshotDate,
        target_month: targetMonth,
        rawdata_count: validation.rawdataCount,
        inbound_count: 0,
        outbound_count: 0,
        stock_count: 0,
        total_value: validation.totalStockValue,
        general_count: whDist["일반"] ?? 0,
        coupang_count: whDist["쿠팡"] ?? 0,
        status: "error",
        error_message: errMsg,
        validation_passed: true,
        auto_committed: false,
        validation_error_reason: `commit_failed:${errMsg}`,
        anomaly_row_count: auto?.anomalyRowCount,
        sum_outbound_total_amount: auto?.sums.sumOutboundTotalAmountField,
        sum_total_price: auto?.sums.sumTotalPrice,
        sum_unit_price_x_qty: auto?.sums.sumUnitPriceXQty,
        source_selection_json: auto?.sourceSelection,
        validation_debug_json: { commit_error: errMsg },
      });
      return NextResponse.json(
        {
          ok: false,
          error: `자동 반영 실패: ${errMsg}`,
          validation,
          serverInfo,
          autoCommit: {
            executed: false,
            validation_passed: true,
            validation_error_reason: `commit_failed:${errMsg}`,
          },
        },
        { status: 500 }
      );
    }
  } catch (e) {
    console.error("[production-sheet-validate] error:", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "파싱 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
