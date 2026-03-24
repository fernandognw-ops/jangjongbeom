/**
 * 웹 UI 승인 기반 단일 반영: 1단계 검증
 * POST /api/production-sheet-validate
 * - 파일 업로드 → 서버 파싱 → 검증 결과 반환
 * - DB 저장 금지
 * - previewToken 발급 (commit 시 필요)
 */

import { NextResponse } from "next/server";
import { parseProductionSheetFromBuffer } from "@/lib/productionSheetParser";
import { toDestWarehouse } from "@/lib/excelParser/classifier";
import { normalizeSalesChannelKr } from "@/lib/inventoryChannels";
import { createPreviewToken } from "@/lib/previewTokenStore";
import { validateSnapshotDatesAgainstFilename } from "@/lib/snapshotUploadValidation";
import { validateOutboundDatesForFilenameMonth } from "@/lib/outboundUploadValidation";
import { defaultDateFromFilename } from "@/lib/excelParser/parser";

const VALID_DEST_WAREHOUSES = ["일반", "쿠팡"];
const VALIDATE_SERVER_MARKER = "validate-v2-sales-channel-breakdown-2026-03-24";

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
      return NextResponse.json({ ok: false, error: "파일이 없습니다." }, { status: 400 });
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
    const outboundSalesChannelDistinctRaw = outboundDateDiagnostics?.outboundSalesChannelDistinctRaw ?? [];
    const outboundSalesChannelClassifiedRaw = {
      coupang: outboundSalesChannelDistinctRaw.filter((v) => normalizeSalesChannelKr(v) === "쿠팡"),
      general: outboundSalesChannelDistinctRaw.filter((v) => normalizeSalesChannelKr(v) === "일반"),
    };
    const outboundSalesChannelGeneralWithCoupangHint =
      outboundSalesChannelClassifiedRaw.general.filter((v) => hasCoupangHint(v));

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
      /** 스냅샷·출고 월 검증 통합 (UI/커밋 게이트) */
      uploadPeriodValid:
        snapVal.snapshotDateValid && outVal.outboundDatePeriodValid && outboundSalesChannelOk,
    };

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
        outboundSalesChannelClassifiedRaw: validation.outboundSalesChannelClassifiedRaw,
        outboundSalesChannelGeneralWithCoupangHint: validation.outboundSalesChannelGeneralWithCoupangHint,
        outboundChannelBreakdown: validation.outboundChannelBreakdown,
        validateServerInfo: serverInfo,
        uploadPeriodValid: validation.uploadPeriodValid,
      })
    );

    if (outboundDateDiagnostics?.outboundSalesChannelColumnFound === false) {
      return NextResponse.json(
        {
          ok: false,
          error:
            '출고 시트에서 「판매 채널」열을 찾을 수 없습니다. 헤더를 "판매 채널", "판매채널", "판매 채널명" 중 하나로 맞추세요. (매출구분 열은 사용하지 않습니다.)',
          validation,
          serverInfo,
          stockDateDiagnostics,
          outboundDateDiagnostics,
        },
        { status: 400 }
      );
    }

    if (stockSnapshot.length > 0 && !snapVal.snapshotDateValid) {
      return NextResponse.json(
        {
          ok: false,
          error: snapVal.snapshotDateMismatchReason ?? "재고 snapshot_date 검증 실패",
          validation,
          serverInfo,
          stockDateDiagnostics,
          outboundDateDiagnostics,
        },
        { status: 400 }
      );
    }

    if (outbound.length > 0 && !outVal.outboundDatePeriodValid) {
      return NextResponse.json(
        {
          ok: false,
          error: outVal.outboundDateMismatchReason ?? "출고 outbound_date 월 검증 실패",
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
      return NextResponse.json(
        {
          ok: false,
          error:
            "출고 시트에 원본 행이 있는데 출고일 열을 찾지 못했거나 유효 행이 0건입니다. 출고일·품번 열을 확인하세요.",
          validation,
          serverInfo,
          stockDateDiagnostics,
          outboundDateDiagnostics,
        },
        { status: 400 }
      );
    }

    const previewToken = createPreviewToken({
      filename: file.name,
      inbound,
      outbound,
      stockSnapshot,
      rawdata: rawdata ?? [],
      currentProductCodes,
      validation,
    });

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

    return NextResponse.json({
      ok: true,
      validation,
      serverInfo,
      previewToken,
      warnings: warnings.length ? warnings : undefined,
      hint: "검증 완료. DB 반영을 위해 previewToken을 사용해 /api/production-sheet-commit 호출",
    });
  } catch (e) {
    console.error("[production-sheet-validate] error:", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "파싱 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
