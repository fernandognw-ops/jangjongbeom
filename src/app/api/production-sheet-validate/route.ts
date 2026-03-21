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

const VALID_DEST_WAREHOUSES = ["일반", "쿠팡"];

function ensureDestWarehouse(wh: string | undefined | null): string {
  const s = String(wh ?? "").trim();
  if (!s) return "일반";
  return toDestWarehouse(s);
}

function validateDestWarehouse(wh: string): boolean {
  const normalized = ensureDestWarehouse(wh);
  return VALID_DEST_WAREHOUSES.includes(normalized);
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "파일이 없습니다." }, { status: 400 });
    }

    const buf = await file.arrayBuffer();
    const result = await parseProductionSheetFromBuffer(buf, file.name);

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.message, missingSheets: result.missingSheets },
        { status: 400 }
      );
    }

    const { inbound, outbound, stockSnapshot, rawdata, currentProductCodes, stockSalesChannelColumnFound } = result;

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
      const wh = r.dest_warehouse ?? "일반";
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
      const wh = ensureDestWarehouse(r.dest_warehouse);
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

    const outboundParsedCount = outbound.length;

    const validation = {
      rawdataCount: rawdata?.length > 0 ? rawdata.length : currentProductCodes.length,
      inboundCount: inbound.length,
      outboundCount: outbound.length,
      outboundParsedCount,
      stockCount: stockSnapshot.length,
      totalStockValue,
      destWarehouseDistribution: whCountTotal,
      destWarehouseBySource: { inbound: whCountInbound, outbound: whCountOutbound, stock: whCountStock },
      snapshotDates,
      destWarehouseValid,
      invalidDestWarehouses: uniqueInvalid,
    };

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

    return NextResponse.json({
      ok: true,
      validation,
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
