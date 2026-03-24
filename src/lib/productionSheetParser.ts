/**
 * 생산수불현황.xlsx 파싱
 * excelParser(공용 파서) 사용 - 로컬 integrated_sync와 동일 규칙
 */

import {
  parseExcelFromBuffer,
  defaultDateFromFilename,
  type RawdataRow,
  type StockSheetDateDiagnostics,
  type OutboundSheetDateDiagnostics,
} from "@/lib/excelParser";

/** 입고에는 sales_channel 미사용 (출고만 사용) */
export interface InboundRow {
  product_code: string;
  quantity: number;
  inbound_date: string;
  dest_warehouse?: string;
  category?: string;
}

export interface OutboundRow {
  product_code: string;
  quantity: number;
  outbound_date: string;
  sales_channel: "coupang" | "general";
  outbound_center?: string;
  dest_warehouse?: string;
  category?: string;
  unit_price?: number;
  /** 엑셀 출고 합계(검증 합산용). DB 적재 시에는 제품 unit_cost로 재계산될 수 있음 */
  total_price?: number;
}

export interface StockSnapshotRow {
  product_code: string;
  quantity: number;
  unit_cost: number;
  /** 판매채널 — DB `dest_warehouse` ("쿠팡"|"일반") */
  dest_warehouse?: string;
  /** 보관센터 — DB `storage_center` */
  storage_center?: string;
  /** 엑셀 재고일자 → snapshot_date (없으면 오늘) */
  snapshot_date?: string;
}

export interface ProductionSheetParseResult {
  ok: true;
  inbound: InboundRow[];
  outbound: OutboundRow[];
  stockSnapshot: StockSnapshotRow[];
  rawdata: RawdataRow[];
  currentProductCodes: string[];
  yearInferred?: number;
  /** 출고 시트 원본 데이터 행 수 (DATA_START_ROW 이후, 필터 전) */
  outboundRawRowCount?: number;
  /** 재고 시트 헤더에 「판매 채널」열이 잡혔는지 — false면 파서가 채널 열을 못 찾아 전부 일반 처리 */
  stockSalesChannelColumnFound?: boolean;
  /** 재고 기준일 열·샘플 (검증/로그) */
  stockDateDiagnostics?: StockSheetDateDiagnostics;
  /** 출고 시트 출고일 열·샘플 */
  outboundDateDiagnostics?: OutboundSheetDateDiagnostics;
}

export interface ProductionSheetParseError {
  ok: false;
  message: string;
  missingSheets?: string[];
  formatError?: string;
}

export type ProductionSheetParseOutput = ProductionSheetParseResult | ProductionSheetParseError;

export async function parseProductionSheetFromBuffer(
  buffer: ArrayBuffer,
  filename?: string
): Promise<ProductionSheetParseOutput> {
  const result = parseExcelFromBuffer(buffer, filename);
  if (!result.ok) {
    return {
      ok: false,
      message: result.message,
      missingSheets: result.missingSheets,
    };
  }
  const currentProductCodes = new Set<string>();
  for (const r of result.inbound) currentProductCodes.add(r.product_code);
  for (const r of result.outbound) currentProductCodes.add(r.product_code);
  for (const r of result.stock) currentProductCodes.add(r.product_code);
  for (const r of result.rawdata) currentProductCodes.add(r.product_code);

  const inbound: InboundRow[] = result.inbound.map((r) => ({
    product_code: r.product_code,
    quantity: r.quantity,
    inbound_date: r.inbound_date,
    ...(r.dest_warehouse && { dest_warehouse: r.dest_warehouse }),
    ...(r.category && { category: r.category }),
  }));

  const outbound: OutboundRow[] = result.outbound.map((r) => ({
    product_code: r.product_code,
    quantity: r.quantity,
    outbound_date: r.outbound_date,
    sales_channel: r.sales_channel as "coupang" | "general",
    ...(r.outbound_center && { outbound_center: r.outbound_center }),
    ...(r.dest_warehouse && { dest_warehouse: r.dest_warehouse }),
    ...(r.category && { category: r.category }),
    ...(typeof r.unit_price === "number" && r.unit_price > 0 ? { unit_price: r.unit_price } : {}),
    ...(typeof r.total_price === "number" && r.total_price > 0 ? { total_price: r.total_price } : {}),
  }));

  const fileDay = defaultDateFromFilename(filename);
  const fallbackDay = fileDay ?? new Date().toISOString().slice(0, 10);
  const stockSnapshot: StockSnapshotRow[] = result.stock.map((r) => ({
    product_code: r.product_code,
    quantity: r.quantity,
    unit_cost: r.unit_cost ?? 0,
    dest_warehouse: r.dest_warehouse,
    storage_center: r.storage_center,
    snapshot_date: (r.snapshot_date ?? r.stock_date ?? fallbackDay).slice(0, 10),
  }));

  const diag = result.stockDateDiagnostics;
  if (diag && stockSnapshot.length > 0) {
    const first = stockSnapshot[0];
    console.log(
      "[productionSheetParser:snapshot-date]",
      JSON.stringify({
        filename: filename ?? "",
        stockDateColumnIndex: diag.stockDateColumnIndex,
        stockDateColumnHeader: diag.stockDateColumnHeader,
        filenameExtractedDate: diag.filenameExtractedDate ?? null,
        fileDefaultDate: diag.fileDefaultDate,
        firstRowSnapshotDate: first?.snapshot_date,
      })
    );
  }

  const odiag = result.outboundDateDiagnostics;
  if (odiag && outbound.length > 0) {
    console.log(
      "[productionSheetParser:outbound-date]",
      JSON.stringify({
        filename: filename ?? "",
        outboundDateColumnHeader: odiag.outboundDateColumnHeader,
        outboundDateColumnIndex: odiag.outboundDateColumnIndex,
        samples: odiag.samples?.slice(0, 5),
      })
    );
  }

  return {
    ok: true,
    inbound,
    outbound,
    stockSnapshot,
    rawdata: result.rawdata ?? [],
    currentProductCodes: Array.from(currentProductCodes),
    outboundRawRowCount: result.outboundRawRowCount ?? 0,
    stockSalesChannelColumnFound: result.stockSheetDiagnostics?.salesChannelColumnFound,
    stockDateDiagnostics: result.stockDateDiagnostics,
    outboundDateDiagnostics: result.outboundDateDiagnostics,
  };
}

export async function parseProductionSheet(file: File): Promise<ProductionSheetParseOutput> {
  const buf = await file.arrayBuffer();
  return parseProductionSheetFromBuffer(buf, file.name);
}
