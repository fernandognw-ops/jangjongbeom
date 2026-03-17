/**
 * 생산수불현황.xlsx 파싱 (0316 형식)
 * 입고·출고·재고 시트 → Supabase 업로드용 데이터
 *
 * 규칙 (0316_생산수불현황.xlsx):
 * - 4행: 헤더 (품목코드, 수량, 입고일자/출고일자 등)
 * - 5행: 서브헤더 (일반/쿠팡 등)
 * - 6행부터: 실제 데이터
 */

import * as XLSX from "xlsx";

const REQUIRED_SHEETS = ["입고", "출고", "재고"] as const;

/** 헤더 다음 서브헤더 1행 건너뛰고 데이터 시작 */
const DATA_ROW_OFFSET = 2;

function findCol(
  row: unknown[],
  names: string[],
  opts?: { exclude?: string[] }
): number {
  const normalize = (s: string) => s.replace(/\s/g, "").toLowerCase();
  const excl = (opts?.exclude ?? []).map(normalize);
  for (let i = 0; i < row.length; i++) {
    const v = normalize(String(row[i] ?? ""));
    if (!v) continue;
    if (excl.some((e) => v === e)) continue;
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

/** Python integrated_sync와 동일: 창고명 정규화 */
function normalizeWarehouse(w: string): string {
  const s = String(w ?? "").trim();
  if (!s) return "제이에스";
  if (/테이칼튼1공장|테이칼튼1/.test(s)) return "테이칼튼1공장";
  if (/테이칼튼/.test(s)) return "테이칼튼";
  if (/제이에스/.test(s)) return "제이에스";
  if (/컬리/.test(s)) return "컬리";
  return "제이에스";
}

/** 입고에는 sales_channel 미사용 (출고만 사용) - Python integrated_sync와 동일 컬럼 */
export interface InboundRow {
  product_code: string;
  product_name?: string;
  quantity: number;
  inbound_date: string;
  category?: string;
  pack_size?: number;
  dest_warehouse?: string;
  unit_price?: number;
  total_price?: number;
}

export interface OutboundRow {
  product_code: string;
  product_name?: string;
  quantity: number;
  outbound_date: string;
  sales_channel: "coupang" | "general";
  category?: string;
  pack_size?: number;
  dest_warehouse?: string;
  unit_price?: number;
  total_price?: number;
}

/** Python integrated_sync와 동일: (product_code, dest_warehouse) 집계 */
export interface StockSnapshotRow {
  product_code: string;
  quantity: number;
  unit_cost: number;
  dest_warehouse?: string;
  total_price?: number;
}

/** Python integrated_sync rawdata와 동일: inventory_products upsert용 */
export interface RawProductRow {
  product_code: string;
  product_name: string;
  unit_cost: number;
  category: string;
  pack_size: number;
}

export interface ProductionSheetParseResult {
  ok: true;
  /** rawdata 시트 (있으면) → inventory_products */
  rawProducts: RawProductRow[];
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

  const findSheetByName = (want: string, fallbacks?: string[]): string | null => {
    const norm = (s: string) => s.replace(/\s/g, "").toLowerCase();
    const w = norm(want);
    const found = sheetNames.find((s) => norm(s) === w);
    if (found) return found;
    for (const orig of sheetNames) {
      if (norm(orig).includes(w) || w.includes(norm(orig))) return orig;
    }
    if (fallbacks) {
      for (const fb of fallbacks) {
        const fbNorm = norm(fb);
        for (const orig of sheetNames) {
          if (norm(orig).includes(fbNorm) || fbNorm.includes(norm(orig))) return orig;
        }
      }
    }
    return null;
  };

  /** Python integrated_sync와 동일: rawdata 시트 → inventory_products (있으면) */
  const rawProducts: RawProductRow[] = [];
  const rawSheetName = findSheetByName("rawdata", ["제품현황_일반", "제품현황_상세", "제품현황", "품절관리_일반", "품절관리"]);
  if (rawSheetName) {
    const rawSheet = wb.Sheets[rawSheetName];
    if (rawSheet) {
      const data = XLSX.utils.sheet_to_json(rawSheet, { header: 1, defval: "" }) as unknown[][];
      const headerRow = findHeaderRow(rawSheet, [
        ["품목코드", "품번", "제품코드", "SKU"],
        ["품목명", "제품명", "품명"],
      ]);
      if (headerRow >= 0) {
        const h = (data[headerRow] ?? []) as unknown[];
        const idxCode = findCol(h, ["품목코드", "품번", "제품코드", "SKU"]);
        const idxName = findCol(h, ["품목명", "제품명", "품명"]);
        const idxCost = findCol(h, ["제품 원가표(개당)", "제품원가표(개당)", "제품원가표", "원가", "단가"]);
        const idxCat = findCol(h, ["품목", "품목구분", "카테고리"], { exclude: ["품목코드", "품번"] });
        const idxPack = findCol(h, ["입수량", "입수"]);
        if (idxCode >= 0) {
          const dataStart = headerRow + 1;
          for (let r = dataStart; r < data.length; r++) {
            const row = (data[r] ?? []) as unknown[];
            const code = String(row[idxCode] ?? "").trim();
            if (!code || code.toLowerCase() === "nan") continue;
            const digits = (code.match(/\d/g) ?? []).length;
            if (code.length < 5 || digits < code.length * 0.5) continue;
            const name = idxName >= 0 ? String(row[idxName] ?? "").trim() : "";
            const cost = idxCost >= 0 ? safeFloat(row[idxCost]) : 0;
            const cat = idxCat >= 0 ? String(row[idxCat] ?? "").trim() : "";
            const pack = idxPack >= 0 ? safeInt(row[idxPack]) || 1 : 1;
            rawProducts.push({
              product_code: code,
              product_name: name || code,
              unit_cost: cost,
              category: cat || "기타",
              pack_size: pack > 0 ? pack : 1,
            });
          }
          if (rawProducts.length > 0) {
            console.log(`[생산수불현황] rawdata: ${rawProducts.length}건`);
          }
        }
      }
    }
  }

  const inbound: InboundRow[] = [];
  const outbound: OutboundRow[] = [];
  const stockSnapshot: StockSnapshotRow[] = [];
  const currentProductCodes = new Set<string>();

  // 입고 시트 (4행 헤더, 6행부터 데이터)
  const inSheet = getSheet("입고");
  if (inSheet) {
    const data = XLSX.utils.sheet_to_json(inSheet, { header: 1, defval: "" }) as unknown[][];
    const headerRow = findHeaderRow(inSheet, [
      ["품목코드", "품번", "제품코드", "SKU"],
      ["수량"],
      ["입고일자", "입고일", "일자"],
    ]);
    if (headerRow < 0) {
      return {
        ok: false,
        message: "입고 시트: 품목코드, 수량, 입고일자 열이 필요합니다. (4행 헤더, 6행부터 데이터)",
        formatError: "입고",
      };
    }
    const h = (data[headerRow] ?? []) as unknown[];
    const idxCode = findCol(h, ["품목코드", "품번", "제품코드", "SKU"]);
    const idxQty = findCol(h, ["수량"], { exclude: ["입수량"] });
    const idxDate = findCol(h, ["입고일자", "입고일", "일자"]);
    const idxCat = findCol(h, ["품목구분", "품목", "카테고리"], { exclude: ["품목코드", "품번"] });
    const idxName = findCol(h, ["제품명", "품목명", "품명"]);
    const idxPack = findCol(h, ["입수량", "입수"]);
    const idxWh = findCol(h, ["입고처", "창고명", "dest_warehouse"]);
    const idxUnit = findCol(h, ["원가", "단가"]);
    const idxTotal = findCol(h, ["합계원가", "합계", "원가합계"]);

    if (idxCode < 0 || idxQty < 0 || idxDate < 0) {
      return {
        ok: false,
        message: "입고 시트: 품목코드, 수량, 입고일자 열이 필요합니다. (4행 헤더, 6행부터 데이터)",
        formatError: "입고",
      };
    }

    const dataStartRow = headerRow + DATA_ROW_OFFSET;
    for (let r = dataStartRow; r < data.length; r++) {
      const row = (data[r] ?? []) as unknown[];
      const code = String(row[idxCode] ?? "").trim();
      const qty = safeInt(row[idxQty]);
      const dateStr = parseDate(row[idxDate], year);
      if (!code || code.toLowerCase() === "nan" || qty <= 0 || !dateStr) continue;
      const category = idxCat >= 0 ? String(row[idxCat] ?? "").trim() : undefined;
      const productName = idxName >= 0 ? String(row[idxName] ?? "").trim() : undefined;
      const packSize = idxPack >= 0 ? safeInt(row[idxPack]) || 1 : undefined;
      const destWarehouse = idxWh >= 0 ? String(row[idxWh] ?? "").trim() : undefined;
      const unitPrice = idxUnit >= 0 ? safeFloat(row[idxUnit]) : undefined;
      const totalPrice = idxTotal >= 0 ? safeFloat(row[idxTotal]) : undefined;
      inbound.push({
        product_code: code,
        quantity: qty,
        inbound_date: dateStr,
        ...(category && { category }),
        ...(productName && { product_name: productName }),
        ...(packSize && packSize > 0 && { pack_size: packSize }),
        ...(destWarehouse && { dest_warehouse: destWarehouse }),
        ...(unitPrice != null && unitPrice > 0 && { unit_price: unitPrice }),
        ...(totalPrice != null && totalPrice > 0 && { total_price: totalPrice }),
      });
    }
    if (inbound.length > 0) {
      inbound.slice(0, 3).forEach((r) => console.log(`[생산수불현황] 품목 ${r.product_code}: ${r.inbound_date} 입고`));
      console.log(`[생산수불현황] 입고: ${inbound.length}건 (연도: ${year}년)`);
    }
  }

  // 출고 시트 (4행 헤더, 6행부터 데이터)
  const outSheet = getSheet("출고");
  if (outSheet) {
    const data = XLSX.utils.sheet_to_json(outSheet, { header: 1, defval: "" }) as unknown[][];
    const headerRow = findHeaderRow(outSheet, [
      ["품목코드", "품번", "제품코드", "SKU"],
      ["수량"],
      ["출고일자", "출고일", "일자"],
    ]);
    if (headerRow < 0) {
      return {
        ok: false,
        message: "출고 시트: 품목코드, 수량, 출고일자 열이 필요합니다. (4행 헤더, 6행부터 데이터)",
        formatError: "출고",
      };
    }
    const h = (data[headerRow] ?? []) as unknown[];
    const idxCode = findCol(h, ["품목코드", "품번", "제품코드", "SKU"]);
    const idxQty = findCol(h, ["수량"], { exclude: ["입수량"] });
    const idxDate = findCol(h, ["출고일자", "출고일", "일자"]);
    const idxSc = findCol(h, ["매출구분", "판매처"]);
    const idxCat = findCol(h, ["품목구분", "품목", "카테고리"], { exclude: ["품목코드", "품번"] });
    const idxName = findCol(h, ["제품명", "품목명", "품명"]);
    const idxPack = findCol(h, ["입수량", "입수"]);
    const idxWh = findCol(h, ["출고처", "창고명", "dest_warehouse"]);
    const idxUnit = findCol(h, ["원가", "단가"]);
    const idxTotal = findCol(h, ["합계", "합계원가"]);

    if (idxCode < 0 || idxQty < 0 || idxDate < 0) {
      return {
        ok: false,
        message: "출고 시트: 품목코드, 수량, 출고일자 열이 필요합니다. (4행 헤더, 6행부터 데이터)",
        formatError: "출고",
      };
    }

    const dataStartRow = headerRow + DATA_ROW_OFFSET;
    for (let r = dataStartRow; r < data.length; r++) {
      const row = (data[r] ?? []) as unknown[];
      const code = String(row[idxCode] ?? "").trim();
      const qty = safeInt(row[idxQty]);
      const dateStr = parseDate(row[idxDate], year);
      if (!code || code.toLowerCase() === "nan" || qty <= 0 || !dateStr) continue;
      const category = idxCat >= 0 ? String(row[idxCat] ?? "").trim() : undefined;
      const productName = idxName >= 0 ? String(row[idxName] ?? "").trim() : undefined;
      const packSize = idxPack >= 0 ? safeInt(row[idxPack]) || 1 : undefined;
      const destWarehouse = idxWh >= 0 ? String(row[idxWh] ?? "").trim() : undefined;
      const unitPrice = idxUnit >= 0 ? safeFloat(row[idxUnit]) : undefined;
      const totalPrice = idxTotal >= 0 ? safeFloat(row[idxTotal]) : undefined;
      outbound.push({
        product_code: code,
        quantity: qty,
        outbound_date: dateStr,
        sales_channel: idxSc >= 0 ? toSalesChannel(row[idxSc]) : "general",
        ...(category && { category }),
        ...(productName && { product_name: productName }),
        ...(packSize && packSize > 0 && { pack_size: packSize }),
        ...(destWarehouse && { dest_warehouse: destWarehouse }),
        ...(unitPrice != null && unitPrice > 0 && { unit_price: unitPrice }),
        ...(totalPrice != null && totalPrice > 0 && { total_price: totalPrice }),
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
    const idxAmount = findCol(h, ["재고 금액", "재고금액", "재고원가"]);
    const idxWh = findCol(h, ["창고명", "창고", "보관장소", "입고처", "warehouse"]);

    if (idxCode < 0 || idxQty < 0) {
      return {
        ok: false,
        message: "재고 시트: 품목코드, 수량 열이 필요합니다.",
        formatError: "재고",
      };
    }

    /** Python integrated_sync와 동일: (product_code, dest_warehouse)별 집계 */
    const agg: Record<string, { qty: number; cost: number; totalPrice: number }> = {};
    const stockDataStart = headerRow + DATA_ROW_OFFSET;
    for (let r = stockDataStart; r < data.length; r++) {
      const row = (data[r] ?? []) as unknown[];
      const code = String(row[idxCode] ?? "").trim();
      if (!code || code.toLowerCase() === "nan") continue;
      const digits = (code.match(/\d/g) ?? []).length;
      if (code.length < 5 || digits < code.length * 0.5) continue;

      const qty = safeInt(row[idxQty]);
      let cost = idxCost >= 0 ? safeFloat(row[idxCost]) : 0;
      const amount = idxAmount >= 0 ? safeFloat(row[idxAmount]) : 0;
      if (cost <= 0 && amount > 0 && qty > 0) cost = amount / qty;
      const totalPrice = amount > 0 ? amount : qty * cost;

      const whRaw = idxWh >= 0 ? String(row[idxWh] ?? "").trim() : "";
      const wh = whRaw ? normalizeWarehouse(whRaw) : "제이에스";
      const key = `${code}|${wh}`;

      if (!agg[key]) agg[key] = { qty: 0, cost: 0, totalPrice: 0 };
      agg[key].qty += qty;
      agg[key].cost = cost > 0 ? cost : agg[key].cost;
      agg[key].totalPrice += totalPrice;
    }

    const today = new Date().toISOString().slice(0, 10);
    for (const [key, { qty, cost, totalPrice }] of Object.entries(agg)) {
      const [code, wh] = key.split("|");
      currentProductCodes.add(code);
      stockSnapshot.push({
        product_code: code,
        quantity: qty,
        unit_cost: Math.round(cost * 100) / 100,
        dest_warehouse: wh,
        total_price: Math.round(totalPrice * 100) / 100,
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
    rawProducts,
    inbound,
    outbound,
    stockSnapshot,
    currentProductCodes: Array.from(currentProductCodes),
    yearInferred: year,
  };
}
