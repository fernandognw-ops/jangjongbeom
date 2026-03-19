/**
 * 공용 엑셀 파서 (common/parser.py와 동일 규칙)
 * 입고/출고/재고 시트 파싱
 */

import * as XLSX from "xlsx";
import {
  HEADER_ROW,
  DATA_START_ROW,
  SYNONYMS,
  QTY_EXCLUDE,
} from "./rules";
import {
  normalizeValue,
  toDestWarehouse,
  toSalesChannel,
} from "./classifier";

type Row = unknown[];

function norm(s: string): string {
  return normalizeValue(s);
}

function findCol(
  row: Row,
  synonymsKey: keyof typeof SYNONYMS,
  exclude?: string[]
): number {
  const names = SYNONYMS[synonymsKey] ?? [];
  const excl = new Set((exclude ?? []).map(norm));
  if (synonymsKey === "total_price") {
    excl.add(norm("재고원가"));
  }
  if (synonymsKey === "unit_cost") {
    excl.add(norm("합계"));
    excl.add(norm("합계원가"));
    excl.add(norm("합계금액"));
  }
  for (let i = 0; i < row.length; i++) {
    const v = norm(String(row[i] ?? ""));
    if (excl.size > 0 && [...excl].some((ex) => v.includes(ex))) continue;
    for (const n of names) {
      const nv = norm(n);
      if (nv.includes(v) || v.includes(nv)) return i;
    }
  }
  return -1;
}

function findQtyCol(row: Row): number {
  const names = SYNONYMS.quantity;
  const excl = new Set(QTY_EXCLUDE.map(norm));
  for (let i = 0; i < row.length; i++) {
    const v = norm(String(row[i] ?? ""));
    if ([...excl].some((ex) => v.includes(ex))) continue;
    for (const n of names) {
      const nv = norm(n);
      if (nv.includes(v) || v.includes(nv)) return i;
    }
  }
  return -1;
}

function parseDate(
  val: unknown,
  year: number,
  fallback: string | null
): string | null {
  if (val == null) return fallback;
  if (typeof val === "object" && "getFullYear" in val) {
    const d = val as Date;
    let y = d.getFullYear();
    if (y < 2000 || y > 2030) y = year;
    return `${y}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  if (typeof val === "number" && Number.isFinite(val) && val > 0) {
    try {
      const parsed = XLSX.SSF?.parse_date_code?.(val);
      if (parsed?.y && parsed?.m && parsed?.d) {
        let y = parsed.y;
        if (y < 2000 || y > 2030) y = year;
        return `${y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
      }
      const excelEpoch = new Date(1899, 11, 30);
      const jsDate = new Date(excelEpoch.getTime() + val * 86400 * 1000);
      let y = jsDate.getFullYear();
      if (y < 2000 || y > 2030) y = year;
      return `${y}-${String(jsDate.getMonth() + 1).padStart(2, "0")}-${String(jsDate.getDate()).padStart(2, "0")}`;
    } catch {
      return fallback;
    }
  }
  const s = String(val).trim();
  if (!s) return fallback;
  if (s.length >= 10 && s[4] === "-" && s[7] === "-") return s.slice(0, 10);
  const m = s.match(/^(\d{2,4})년?\s*(\d{2})\.?(\d{2})?/);
  if (m) {
    let y = parseInt(m[1], 10);
    if (y < 100) y += y < 50 ? 2000 : 1900;
    const mo = parseInt(m[2], 10);
    const d = m[3] ? parseInt(m[3], 10) : 1;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  try {
    const dt = new Date(val as string | number);
    if (!isNaN(dt.getTime())) {
      return dt.toISOString().slice(0, 10);
    }
  } catch {
    // ignore
  }
  return fallback;
}

function yearFromFilename(filename: string | undefined): number {
  if (!filename) return new Date().getFullYear();
  const name = filename.split(/[/\\]/).pop() ?? "";
  if (/26년|2026|_26\b|\(26\)/.test(name)) return 2026;
  if (/25년|2025|_25\b|\(25\)/.test(name)) return 2025;
  const m = name.match(/(\d{4})/);
  if (m) {
    const y = parseInt(m[1], 10);
    if (y >= 2020 && y <= 2030) return y;
  }
  return new Date().getFullYear();
}

function safeInt(val: unknown): number {
  if (val == null) return 0;
  const n = parseInt(String(val).replace(/[,.\s]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

function safeFloat(val: unknown): number {
  if (val == null) return 0;
  const n = parseFloat(String(val).replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function validProductCode(code: string): boolean {
  if (!code || code.toLowerCase() === "nan") return false;
  if (code.length < 5) return false;
  const digits = (code.match(/\d/g) ?? []).length;
  if (digits < code.length * 0.5) return false;
  if (code.includes("합계") || code.includes("소계")) return false;
  return true;
}

export interface InboundRow {
  product_code: string;
  product_name: string;
  quantity: number;
  inbound_center: string;
  inbound_date: string;
  warehouse_group: string;
  event_type: "inbound";
  dest_warehouse?: string;
  category?: string;
  pack_size?: number;
  unit_price?: number;
  total_price?: number;
}

export interface OutboundRow {
  product_code: string;
  product_name: string;
  quantity: number;
  outbound_center: string;
  outbound_date: string;
  warehouse_group: string;
  sales_channel: "coupang" | "general";
  event_type: "outbound";
  dest_warehouse?: string;
  category?: string;
  pack_size?: number;
  unit_price?: number;
  total_price?: number;
}

export interface StockRow {
  product_code: string;
  product_name: string;
  quantity: number;
  storage_center: string;
  stock_date: string;
  warehouse_group: string;
  event_type: "stock";
  dest_warehouse: string;
  unit_cost: number;
  total_price: number;
  snapshot_date: string;
  category?: string;
  pack_size?: number;
}

export function parseInboundSheet(
  data: unknown[][],
  filename?: string,
  sheetName = "입고"
): InboundRow[] {
  if (data.length <= HEADER_ROW) return [];
  const headerRow = data[HEADER_ROW] ?? [];
  const idxCode = findCol(headerRow, "product_code");
  const idxName = findCol(headerRow, "product_name");
  const idxQty = findQtyCol(headerRow);
  const idxCenter = findCol(headerRow, "inbound_center");
  const idxDate = findCol(headerRow, "inbound_date");
  const idxCat = findCol(headerRow, "category");
  const idxPack = findCol(headerRow, "pack_size");
  const idxUnit = findCol(headerRow, "unit_price");
  const idxTotal = findCol(headerRow, "total_price_inbound");

  if (idxCode < 0 || idxQty < 0 || idxDate < 0) return [];

  const year = yearFromFilename(filename);
  const today = new Date().toISOString().slice(0, 10);
  const rows: InboundRow[] = [];

  for (let i = DATA_START_ROW; i < data.length; i++) {
    const row = (data[i] ?? []) as Row;
    const code = String(row[idxCode] ?? "").trim();
    const qty = safeInt(row[idxQty]);
    const dateVal = row[idxDate];
    const dateStr = parseDate(dateVal, year, today);
    if (!validProductCode(code) || qty <= 0 || !dateStr) continue;

    const name =
      idxName >= 0 ? String(row[idxName] ?? "").trim() : "";
    const centerRaw = idxCenter >= 0 ? String(row[idxCenter] ?? "").trim() : "";
    const destWh = toDestWarehouse(centerRaw);
    const cat = idxCat >= 0 ? String(row[idxCat] ?? "").trim() : "";
    const pack = idxPack >= 0 ? safeInt(row[idxPack]) : 1;
    const unit = idxUnit >= 0 ? safeFloat(row[idxUnit]) : 0;
    const total = idxTotal >= 0 ? safeFloat(row[idxTotal]) : 0;

    rows.push({
      product_code: code,
      product_name: name || code,
      quantity: qty,
      inbound_center: centerRaw,
      inbound_date: dateStr,
      warehouse_group: destWh,
      event_type: "inbound",
      dest_warehouse: destWh,
      category: cat || "기타",
      pack_size: pack > 0 ? pack : 1,
      unit_price: unit,
      total_price: total,
    });
  }
  return rows;
}

export function parseOutboundSheet(
  data: unknown[][],
  filename?: string,
  sheetName = "출고"
): OutboundRow[] {
  if (data.length <= HEADER_ROW) return [];
  const headerRow = data[HEADER_ROW] ?? [];
  const idxCode = findCol(headerRow, "product_code");
  const idxName = findCol(headerRow, "product_name");
  const idxQty = findQtyCol(headerRow);
  const idxCenter = findCol(headerRow, "outbound_center");
  const idxDate = findCol(headerRow, "outbound_date");
  const idxSc = findCol(headerRow, "sales_channel");
  const idxCat = findCol(headerRow, "category");
  const idxPack = findCol(headerRow, "pack_size");
  const idxUnit = findCol(headerRow, "unit_price");
  const idxTotal = findCol(headerRow, "total_price_outbound");

  if (idxCode < 0 || idxQty < 0 || idxDate < 0) return [];

  const year = yearFromFilename(filename);
  const today = new Date().toISOString().slice(0, 10);
  const rows: OutboundRow[] = [];

  for (let i = DATA_START_ROW; i < data.length; i++) {
    const row = (data[i] ?? []) as Row;
    const code = String(row[idxCode] ?? "").trim();
    const qty = safeInt(row[idxQty]);
    const dateVal = row[idxDate];
    const dateStr = parseDate(dateVal, year, today);
    if (!validProductCode(code) || qty <= 0 || !dateStr) continue;

    const name = idxName >= 0 ? String(row[idxName] ?? "").trim() : "";
    const centerRaw = idxCenter >= 0 ? String(row[idxCenter] ?? "").trim() : "";
    const scRaw = idxSc >= 0 ? String(row[idxSc] ?? "").trim() : "";
    const destWh = toDestWarehouse(scRaw || centerRaw);
    const salesChannel = toSalesChannel(scRaw || centerRaw);
    const cat = idxCat >= 0 ? String(row[idxCat] ?? "").trim() : "";
    const pack = idxPack >= 0 ? safeInt(row[idxPack]) : 1;
    const unit = idxUnit >= 0 ? safeFloat(row[idxUnit]) : 0;
    const total = idxTotal >= 0 ? safeFloat(row[idxTotal]) : 0;

    rows.push({
      product_code: code,
      product_name: name || code,
      quantity: qty,
      outbound_center: centerRaw,
      outbound_date: dateStr,
      warehouse_group: destWh,
      sales_channel: salesChannel,
      event_type: "outbound",
      dest_warehouse: destWh,
      category: cat || "기타",
      pack_size: pack > 0 ? pack : 1,
      unit_price: unit,
      total_price: total,
    });
  }
  return rows;
}

export function parseStockSheet(
  data: unknown[][],
  filename?: string,
  sheetName = "재고"
): StockRow[] {
  if (data.length <= HEADER_ROW) return [];
  const headerRow = data[HEADER_ROW] ?? [];
  const idxCode = findCol(headerRow, "product_code");
  const idxName = findCol(headerRow, "product_name");
  const idxQty = findQtyCol(headerRow);
  const idxCenter = findCol(headerRow, "storage_center");
  const idxDate = findCol(headerRow, "stock_date");
  const idxCost = findCol(headerRow, "unit_cost");
  const idxTotal = findCol(headerRow, "total_price");
  const idxCat = findCol(headerRow, "category");
  const idxPack = findCol(headerRow, "pack_size");

  if (idxCode < 0 || idxQty < 0) return [];

  const year = yearFromFilename(filename);
  const today = new Date().toISOString().slice(0, 10);
  const rows: StockRow[] = [];

  for (let i = DATA_START_ROW; i < data.length; i++) {
    const row = (data[i] ?? []) as Row;
    const code = String(row[idxCode] ?? "").trim();
    if (!validProductCode(code)) continue;

    const qty = safeInt(row[idxQty]);
    const name = idxName >= 0 ? String(row[idxName] ?? "").trim() : "";
    const centerRaw = idxCenter >= 0 ? String(row[idxCenter] ?? "").trim() : "";
    const destWh = toDestWarehouse(centerRaw);
    const dateVal = row[idxDate];
    const dateStr = parseDate(dateVal, year, today);
    const cost = idxCost >= 0 ? safeFloat(row[idxCost]) : 0;
    const total = idxTotal >= 0 ? safeFloat(row[idxTotal]) : 0;
    const cat = idxCat >= 0 ? String(row[idxCat] ?? "").trim() : "";
    const pack = idxPack >= 0 ? safeInt(row[idxPack]) : 1;

    rows.push({
      product_code: code,
      product_name: name || code,
      quantity: qty,
      storage_center: centerRaw,
      stock_date: dateStr ?? today,
      warehouse_group: destWh,
      event_type: "stock",
      dest_warehouse: destWh,
      unit_cost: cost,
      total_price: total > 0 ? total : 0,
      snapshot_date: dateStr ?? today,
      category: cat || "기타",
      pack_size: pack > 0 ? pack : 1,
    });
  }
  return rows;
}

const RAWDATA_HEADER_POOL = [
  ["품목코드", "품번"],
  ["품목명", "제품명", "품명"],
];

function findHeaderRowRawdata(data: unknown[][]): number {
  for (let r = 0; r < Math.min(10, data.length); r++) {
    const row = (data[r] ?? []) as Row;
    const hasCode = RAWDATA_HEADER_POOL[0].some((n) =>
      row.some((c) => norm(String(c ?? "")).includes(norm(n)))
    );
    const hasName = RAWDATA_HEADER_POOL[1].some((n) =>
      row.some((c) => norm(String(c ?? "")).includes(norm(n)))
    );
    if (hasCode && hasName) return r;
  }
  return -1;
}

export function parseRawdataSheet(
  data: unknown[][],
  filename?: string
): RawdataRow[] {
  const hr = findHeaderRowRawdata(data);
  if (hr < 0) return [];

  const headerRow = (data[hr] ?? []) as Row;
  const idxCode = findCol(headerRow, "product_code");
  const idxName = findCol(headerRow, "product_name");
  const idxCost = findCol(headerRow, "unit_cost");
  const idxCat = findCol(headerRow, "category");
  const idxPack = findCol(headerRow, "pack_size");

  if (idxCode < 0) return [];

  const rows: RawdataRow[] = [];
  for (let i = hr + 1; i < data.length; i++) {
    const row = (data[i] ?? []) as Row;
    const code = String(row[idxCode] ?? "").trim();
    if (!code || code.toLowerCase() === "nan") continue;
    const digits = (code.match(/\d/g) ?? []).length;
    if (code.length < 5 || digits < code.length * 0.5) continue;

    const name =
      idxName >= 0 ? String(row[idxName] ?? "").trim() : "";
    const cost = idxCost >= 0 ? safeFloat(row[idxCost]) : 0;
    const cat = idxCat >= 0 ? String(row[idxCat] ?? "").trim() : "";
    const pack = idxPack >= 0 ? safeInt(row[idxPack]) : 1;

    rows.push({
      product_code: code,
      product_name: name || code,
      unit_cost: cost || 0,
      category: cat || "기타",
      pack_size: pack > 0 ? pack : 1,
    });
  }
  return rows;
}

export interface RawdataRow {
  product_code: string;
  product_name: string;
  unit_cost: number;
  category: string;
  pack_size: number;
}

export interface ParseResult {
  ok: true;
  inbound: InboundRow[];
  outbound: OutboundRow[];
  stock: StockRow[];
  rawdata: RawdataRow[];
  sheetNames: string[];
}

export interface ParseError {
  ok: false;
  message: string;
  missingSheets?: string[];
}

export type ParseOutput = ParseResult | ParseError;

export function parseExcelFromBuffer(
  buffer: ArrayBuffer,
  filename?: string
): ParseOutput {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetNames = wb.SheetNames ?? [];

  const hasSheet = (name: string) =>
    sheetNames.some((s) => norm(s) === norm(name) || norm(s).includes(norm(name)));

  const missing: string[] = [];
  for (const name of ["입고", "출고", "재고"]) {
    if (!hasSheet(name)) missing.push(name);
  }
  if (missing.length > 0) {
    return {
      ok: false,
      message: `필수 시트가 없습니다: ${missing.join(", ")}`,
      missingSheets: missing,
    };
  }

  const getSheetData = (name: string): unknown[][] => {
    const found = sheetNames.find(
      (s) => norm(s) === norm(name) || norm(s).includes(norm(name))
    );
    if (!found || !wb.Sheets[found]) return [];
    const sheet = wb.Sheets[found];
    return (XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
    }) as unknown[][]) ?? [];
  };

  const findRawdataSheet = (): string | null => {
    const candidates = ["rawdata", "제품현황_일반", "제품현황_상세", "제품현황", "품절관리_일반", "품절관리"];
    for (const want of candidates) {
      const found = sheetNames.find(
        (s) => norm(s).includes(norm(want)) || (want === "rawdata" && norm(s).includes("raw") && norm(s).includes("data"))
      );
      if (found) return found;
    }
    return null;
  };

  const inboundData = getSheetData("입고");
  const outboundData = getSheetData("출고");
  const stockData = getSheetData("재고");

  const inbound = parseInboundSheet(inboundData, filename);
  const outbound = parseOutboundSheet(outboundData, filename);
  const stock = parseStockSheet(stockData, filename);

  let rawdata: RawdataRow[] = [];
  const rawdataSheetName = findRawdataSheet();
  if (rawdataSheetName && wb.Sheets[rawdataSheetName]) {
    const rawdataData = XLSX.utils.sheet_to_json(wb.Sheets[rawdataSheetName], {
      header: 1,
      defval: "",
    }) as unknown[][];
    rawdata = parseRawdataSheet(rawdataData ?? [], filename);
  }

  return {
    ok: true,
    inbound,
    outbound,
    stock,
    rawdata,
    sheetNames,
  };
}
