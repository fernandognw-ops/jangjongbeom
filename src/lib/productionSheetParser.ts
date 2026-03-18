/**
 * 생산수불현황.xlsx 파싱
 * excelParser(공용 파서) 사용 - 로컬 integrated_sync와 동일 규칙
 */

import { parseExcelFromBuffer } from "@/lib/excelParser";

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
  dest_warehouse?: string;
  category?: string;
}

export interface StockSnapshotRow {
  product_code: string;
  quantity: number;
  unit_cost: number;
  dest_warehouse?: string;
}

export interface ProductionSheetParseResult {
  ok: true;
  inbound: InboundRow[];
  outbound: OutboundRow[];
  stockSnapshot: StockSnapshotRow[];
  currentProductCodes: string[];
  yearInferred?: number;
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
    ...(r.dest_warehouse && { dest_warehouse: r.dest_warehouse }),
    ...(r.category && { category: r.category }),
  }));

  const stockSnapshot: StockSnapshotRow[] = result.stock.map((r) => ({
    product_code: r.product_code,
    quantity: r.quantity,
    unit_cost: r.unit_cost ?? 0,
    ...(r.dest_warehouse && { dest_warehouse: r.dest_warehouse }),
  }));

  return {
    ok: true,
    inbound,
    outbound,
    stockSnapshot,
    currentProductCodes: Array.from(currentProductCodes),
  };
}

export async function parseProductionSheet(file: File): Promise<ProductionSheetParseOutput> {
  const buf = await file.arrayBuffer();
  return parseProductionSheetFromBuffer(buf, file.name);
}
