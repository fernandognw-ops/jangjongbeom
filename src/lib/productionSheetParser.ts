/**
 * 생산수불현황.xlsx 파싱
 * 입고·출고·재고 시트 → Supabase 업로드용 데이터
 *
 * 규칙:
 * - 입고/출고: 4행(Index 3)부터 데이터 시작
 * - 날짜: cellDates, Excel serial, "25-10" 형식 지원
 * - 빈 품목코드/날짜 행은 건너뜀
 */

import * as XLSX from "xlsx";

const REQUIRED_SHEETS = ["입고", "출고", "재고"] as const;

/** 입고/출고 시트: 4행(Index 3)부터 실제 데이터가 시작 */
const DATA_START_ROW = 3;

function findCol(
  row: unknown[],
  names: string[],
  opts?: { exclude?: string[] }
): number {
  const normalize = (s: string) => s.replace(/\s/g, "").toLowerCase();
  const excl = (opts?.exclude ?? []).map(normalize);
  for (let i = 0; i < row.length; i++) {
    const v = normalize(String(row[i] ?? ""));
    if (excl.some((e) => v.includes(e) || e.includes(v))) continue;
    for (const n of names) {
      const nv = normalize(n);
      if (v === nv || v.includes(nv) || nv.includes(v)) return i;
    }
  }
  return -1;
}

function findHeaderRow(sheet: XLSX.WorkSheet, colNames: string[][]): number {
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as unknown[][];
  for (let r = 0; r < Math.min(15, data.length); r++) {
    const row = (data[r] ?? []) as unknown[];
    let found = 0;
    for (const names of colNames) {
      if (findCol(row, names) >= 0) found++;
    }
    if (found === colNames.length) return r;
  }
  return -1;
}

/**
 * 날짜 파싱: Excel 수식입력줄 실제 날짜(YYYY-MM-DD) 최우선, 텍스트만 파일명 연도 조합
 * 파일명에 '25년','26년' 포함 시 해당 연도를 기준 연도로 강제
 */
function parseDate(val: unknown, year = new Date().getFullYear()): string | null {
  if (val == null) return null;

  // 1. Date 객체 (cellDates: true) - Excel 수식입력줄 실제 날짜 최우선
  if (typeof val === "object" && "getFullYear" in val) {
    const d = val as Date;
    let y = d.getFullYear();
    if (y < 2000 || y > 2030) y = year;
    return `${y}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  // 2. Excel serial number - 수식입력줄 실제 날짜 데이터
  if (typeof val === "number" && Number.isFinite(val) && val > 0) {
    try {
      const parsed = XLSX.SSF?.parse_date_code?.(val);
      if (parsed && parsed.y && parsed.m && parsed.d) {
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
      return null;
    }
  }

  const s = String(val).trim();
  if (!s) return null;

  // 3. YYYY-MM-DD
  const m1 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m1) {
    let y = parseInt(m1[1], 10);
    if (y < 2000 || y > 2030) y = year;
    return `${y}-${m1[2]}-${m1[3]}`;
  }

  // 4. 3월 3일, 3월3일 (텍스트만 → 파일명 연도 강제 조합)
  const mKorean = s.match(/(\d{1,2})월\s*(\d{1,2})일/);
  if (mKorean) {
    const m = parseInt(mKorean[1], 10);
    const d = parseInt(mKorean[2], 10);
    return `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  // 5. 25-10, 2025-10 → 2025-10-01
  const mShort = s.match(/^(\d{2,4})[.\/-](\d{1,2})$/);
  if (mShort) {
    let y = parseInt(mShort[1], 10);
    const m = parseInt(mShort[2], 10);
    if (y < 100) y += y < 50 ? 2000 : 1900;
    return `${y}-${String(m).padStart(2, "0")}-01`;
  }

  // 6. DD.MM.YY / YY.MM.DD 등
  const m2 = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{1,2})$/);
  if (m2) {
    let y = parseInt(m2[1], 10);
    const m = parseInt(m2[2], 10);
    const d = parseInt(m2[3], 10);
    if (y < 100) y += y < 50 ? 2000 : 1900;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return null;
}

function safeInt(val: unknown): number {
  if (val == null) return 0;
  const n = parseInt(String(val).replace(/[,.\s]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

function safeFloat(val: unknown): number {
  if (val == null) return 0;
  const n = parseFloat(String(val).replace(/[,]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function toSalesChannel(val: unknown): "coupang" | "general" {
  const s = String(val ?? "").toLowerCase();
  if (s.includes("쿠팡") || s.includes("coupang")) return "coupang";
  return "general";
}

/** 입고에는 sales_channel 미사용 (출고만 사용) */
export interface InboundRow {
  product_code: string;
  quantity: number;
  inbound_date: string;
  /** 품목구분/품목 (Excel에 있으면 저장) */
  category?: string;
}

export interface OutboundRow {
  product_code: string;
  quantity: number;
  outbound_date: string;
  sales_channel: "coupang" | "general";
  /** 품목구분/품목 (Excel에 있으면 저장) */
  category?: string;
}

export interface StockSnapshotRow {
  product_code: string;
  quantity: number;
  unit_cost: number;
}

export interface ProductionSheetParseResult {
  ok: true;
  inbound: InboundRow[];
  outbound: OutboundRow[];
  stockSnapshot: StockSnapshotRow[];
  currentProductCodes: string[];
  /** 파일명에서 추출한 연도 (25년/26년 등) */
  yearInferred?: number;
}

export interface ProductionSheetParseError {
  ok: false;
  message: string;
  missingSheets?: string[];
  formatError?: string;
}

export type ProductionSheetParseOutput = ProductionSheetParseResult | ProductionSheetParseError;

/** Node.js 등에서 파일 경로로 파싱 (ArrayBuffer 사용) */
export async function parseProductionSheetFromBuffer(
  buffer: ArrayBuffer,
  filename?: string
): Promise<ProductionSheetParseOutput> {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  return parseProductionSheetCore(wb, filename);
}

export async function parseProductionSheet(file: File): Promise<ProductionSheetParseOutput> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  return parseProductionSheetCore(wb, file.name);
}

/** 파일명에서 연도 추출 (25년/26년 우선) - 추측 없이 명시된 값만 사용 */
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

function parseProductionSheetCore(wb: XLSX.WorkBook, filename?: string): ProductionSheetParseOutput {
  const sheetNames = wb.SheetNames ?? [];
  const year = yearFromFilename(filename);

  const hasSheet = (name: string) =>
    sheetNames.some((s) => s.replace(/\s/g, "") === name.replace(/\s/g, ""));

  const missing: string[] = [];
  for (const name of REQUIRED_SHEETS) {
    if (!hasSheet(name)) missing.push(name);
  }
  if (missing.length > 0) {
    return {
      ok: false,
      message: `필수 시트가 없습니다: ${missing.join(", ")}. 생산수불현황.xlsx 형식인지 확인하세요.`,
      missingSheets: missing,
    };
  }

  const getSheet = (name: string) => {
    const found = sheetNames.find((s) => s.replace(/\s/g, "") === name.replace(/\s/g, ""));
    return found ? wb.Sheets[found] : null;
  };

  const inbound: InboundRow[] = [];
  const outbound: OutboundRow[] = [];
  const stockSnapshot: StockSnapshotRow[] = [];
  const currentProductCodes = new Set<string>();

  // 입고 시트 (4행 Index 3부터 데이터)
  const inSheet = getSheet("입고");
  if (inSheet) {
    const data = XLSX.utils.sheet_to_json(inSheet, { header: 1, defval: "" }) as unknown[][];
    const headerRow = Math.min(DATA_START_ROW - 1, 2);
    const h = (data[headerRow] ?? []) as unknown[];
    const idxCode = findCol(h, ["품목코드", "품번", "제품코드", "SKU"]);
    const idxQty = findCol(h, ["수량"], { exclude: ["입수량"] });
    const idxDate = findCol(h, ["입고일자", "입고일", "일자"]);
    const idxCat = findCol(h, ["품목구분", "품목", "카테고리"]);

    if (idxCode < 0 || idxQty < 0 || idxDate < 0) {
      return {
        ok: false,
        message: "입고 시트: 품목코드, 수량, 입고일자 열이 필요합니다. (3행 헤더, 4행부터 데이터)",
        formatError: "입고",
      };
    }

    for (let r = DATA_START_ROW; r < data.length; r++) {
      const row = (data[r] ?? []) as unknown[];
      const code = String(row[idxCode] ?? "").trim();
      const qty = safeInt(row[idxQty]);
      const dateStr = parseDate(row[idxDate], year);
      if (!code || code.toLowerCase() === "nan" || qty <= 0 || !dateStr) continue;
      const category = idxCat >= 0 ? String(row[idxCat] ?? "").trim() : undefined;
      inbound.push({
        product_code: code,
        quantity: qty,
        inbound_date: dateStr,
        ...(category && { category }),
      });
    }
    if (inbound.length > 0) {
      inbound.slice(0, 3).forEach((r) => console.log(`[생산수불현황] 품목 ${r.product_code}: ${r.inbound_date} 입고`));
      console.log(`[생산수불현황] 입고: ${inbound.length}건 (연도: ${year}년)`);
    }
  }

  // 출고 시트 (4행 Index 3부터 데이터)
  const outSheet = getSheet("출고");
  if (outSheet) {
    const data = XLSX.utils.sheet_to_json(outSheet, { header: 1, defval: "" }) as unknown[][];
    const headerRow = Math.min(DATA_START_ROW - 1, 2);
    const h = (data[headerRow] ?? []) as unknown[];
    const idxCode = findCol(h, ["품목코드", "품번", "제품코드", "SKU"]);
    const idxQty = findCol(h, ["수량"], { exclude: ["입수량"] });
    const idxDate = findCol(h, ["출고일자", "출고일", "일자"]);
    const idxSc = findCol(h, ["매출구분", "판매처"]);
    const idxCat = findCol(h, ["품목구분", "품목", "카테고리"]);

    if (idxCode < 0 || idxQty < 0 || idxDate < 0) {
      return {
        ok: false,
        message: "출고 시트: 품목코드, 수량, 출고일자 열이 필요합니다. (3행 헤더, 4행부터 데이터)",
        formatError: "출고",
      };
    }

    for (let r = DATA_START_ROW; r < data.length; r++) {
      const row = (data[r] ?? []) as unknown[];
      const code = String(row[idxCode] ?? "").trim();
      const qty = safeInt(row[idxQty]);
      const dateStr = parseDate(row[idxDate], year);
      if (!code || code.toLowerCase() === "nan" || qty <= 0 || !dateStr) continue;
      const category = idxCat >= 0 ? String(row[idxCat] ?? "").trim() : undefined;
      outbound.push({
        product_code: code,
        quantity: qty,
        outbound_date: dateStr,
        sales_channel: idxSc >= 0 ? toSalesChannel(row[idxSc]) : "general",
        ...(category && { category }),
      });
    }
    if (outbound.length > 0) {
      outbound.slice(0, 3).forEach((r) => console.log(`[생산수불현황] 품목 ${r.product_code}: ${r.outbound_date} 출고`));
      console.log(`[생산수불현황] 출고: ${outbound.length}건 (연도: ${year}년)`);
    }
  }

  // 재고 시트 (품목코드, 수량, 원가)
  const stockSheet = getSheet("재고");
  if (stockSheet) {
    const data = XLSX.utils.sheet_to_json(stockSheet, { header: 1, defval: "" }) as unknown[][];
    const headerRow = findHeaderRow(stockSheet, [
      ["품목코드", "품번", "제품코드", "SKU"],
      ["수량", "재고", "재고수량"],
    ]);
    if (headerRow < 0) {
      return {
        ok: false,
        message: "재고 시트: 품목코드, 수량 열을 찾을 수 없습니다. 파일 형식을 확인하세요.",
        formatError: "재고",
      };
    }
    const h = (data[headerRow] ?? []) as unknown[];
    const idxCode = findCol(h, ["품목코드", "품번", "제품코드", "SKU"]);
    const idxQty = findCol(h, ["수량", "재고", "재고수량"], { exclude: ["입수량"] });
    const idxCost = findCol(h, ["단가", "원가", "제품원가표", "재고원가"]);
    const idxAmount = findCol(h, ["재고 금액", "재고금액"]);

    if (idxCode < 0 || idxQty < 0) {
      return {
        ok: false,
        message: "재고 시트: 품목코드, 수량 열이 필요합니다.",
        formatError: "재고",
      };
    }

    const agg: Record<string, { qty: number; cost: number }> = {};
    for (let r = headerRow + 1; r < data.length; r++) {
      const row = (data[r] ?? []) as unknown[];
      const code = String(row[idxCode] ?? "").trim();
      if (!code || code.toLowerCase() === "nan") continue;
      const digits = (code.match(/\d/g) ?? []).length;
      if (code.length < 5 || digits < code.length * 0.5) continue;

      const qty = safeInt(row[idxQty]);
      let cost = idxCost >= 0 ? safeFloat(row[idxCost]) : 0;
      const amount = idxAmount >= 0 ? safeFloat(row[idxAmount]) : 0;
      if (cost <= 0 && amount > 0 && qty > 0) cost = amount / qty;

      if (!agg[code]) agg[code] = { qty: 0, cost: 0 };
      agg[code].qty += qty;
      agg[code].cost = cost > 0 ? cost : agg[code].cost;
    }

    const today = new Date().toISOString().slice(0, 10);
    for (const [code, { qty, cost }] of Object.entries(agg)) {
      currentProductCodes.add(code);
      stockSnapshot.push({
        product_code: code,
        quantity: qty,
        unit_cost: Math.round(cost * 100) / 100,
      });
    }
  }

  const sampleIn = inbound[0]?.inbound_date;
  const sampleOut = outbound[0]?.outbound_date;
  if (sampleIn || sampleOut) {
    console.log(`[생산수불현황] 최종 파싱된 날짜 예시: 입고 ${sampleIn ?? "-"}, 출고 ${sampleOut ?? "-"}`);
  }

  return {
    ok: true,
    inbound,
    outbound,
    stockSnapshot,
    currentProductCodes: Array.from(currentProductCodes),
    yearInferred: year,
  };
}
