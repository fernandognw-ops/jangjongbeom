import * as XLSX from "xlsx";
import type { ItemId, ProductMasterRow, SalesChannel } from "@/lib/types";
import { parseKoreanDateToISO } from "./csvImport";

export interface CsvImportTxDraft {
  date: string;
  itemId: ItemId;
  type: "in" | "out";
  quantity: number;
  person: string;
  note: string;
  productCode?: string;
  salesChannel?: SalesChannel;
}

// 품목구분 → 카테고리: 마스크, 캡슐세제, 섬유유연제, 액상세제, 생활용품
export function mapGroupToItemId(group: string): ItemId {
  const g = group.replace(/\s+/g, "").toLowerCase();
  if (g.includes("마스크")) return "mask";
  if (g.includes("캡슐세제") || (g.includes("캡슐") && g.includes("세제"))) return "capsule";
  if (g.includes("섬유유연제") || g.includes("유연제")) return "fabric";
  if (g.includes("액상세제") || (g.includes("액상") && g.includes("세제"))) return "liquid";
  return "living"; // 생활용품 (기타)
}

function parseNumberLike(s: string): number | null {
  if (!s || typeof s !== "string") return null;
  const cleaned = String(s).replace(/["\s]/g, "").replace(/,/g, "");
  if (!cleaned) return null;
  const n = Number.parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : null;
}

function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

function parseDate(val: unknown, year = new Date().getFullYear()): string | null {
  const s = String(val ?? "").replace(/["\s]/g, "");
  const m1 = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m1) return `${m1[1]}-${m1[2]}-${m1[3]}`;
  const m2 = s.match(/^(\d{1,2})월(\d{1,2})일$/);
  if (m2) return `${year}-${pad2(Number(m2[1]))}-${pad2(Number(m2[2]))}`;
  const m3 = s.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m3) return `${year}-${pad2(Number(m3[1]))}-${pad2(Number(m3[2]))}`;
  return null;
}

function findSheet(wb: XLSX.WorkBook, names: string[]): XLSX.WorkSheet | null {
  const sheetNames = wb.SheetNames || [];
  for (const name of names) {
    const exact = wb.Sheets[name];
    if (exact) return exact;
    const found = sheetNames.find((s) => s.replace(/\s/g, "").includes(name.replace(/\s/g, "")));
    if (found) return wb.Sheets[found];
  }
  return null;
}

function getSheetData(sheet: XLSX.WorkSheet): { headers: string[]; rows: unknown[][] } {
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as unknown[][];
  if (data.length === 0) return { headers: [], rows: [] };
  const headers = (data[0] as unknown[]).map((c) => String(c ?? "").replace(/\s/g, "")) as string[];
  return { headers, rows: data.slice(1) };
}

function findCol(headers: string[], names: string[]): number {
  for (const n of names) {
    const i = headers.findIndex((h) => h === n || h.includes(n));
    if (i >= 0) return i;
  }
  return -1;
}

export interface UnifiedImportResult {
  products: ProductMasterRow[];
  transactions: CsvImportTxDraft[];
  summary: {
    productsCount: number;
    inCount: number;
    stockCount: number;
    outCount: number;
    openingDate?: string;
  };
}

export async function parseUnifiedFile(
  file: File,
  openingDate?: string
): Promise<UnifiedImportResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheetNames = wb.SheetNames || [];
  const today = openingDate || new Date().toISOString().slice(0, 10);

  const result: UnifiedImportResult = {
    products: [],
    transactions: [],
    summary: { productsCount: 0, inCount: 0, stockCount: 0, outCount: 0 },
  };

  // 1. 제품 시트 (품목코드, 제품명, 품목구분, 원가, 하위품목, 규격)
  const productSheet = findSheet(wb, ["제품", "품목", "제품마스터", "Rawdata"]);
  if (productSheet) {
    const { headers, rows } = getSheetData(productSheet);
    const idxCode = findCol(headers, ["품목코드", "제품코드", "코드"]);
    const idxName = findCol(headers, ["제품명", "품목명"]);
    const idxGroup = findCol(headers, ["품목구분"]);
    const idxCost = findCol(headers, ["원가", "단가"]);
    const idxSub = findCol(headers, ["하위품목"]);
    const idxSpec = findCol(headers, ["규격"]);
    const idxPackSize = findCol(headers, ["입수량", "입수"]);

    if (idxCode >= 0 && idxName >= 0 && idxGroup >= 0) {
      for (const row of rows) {
        const arr = Array.isArray(row) ? row : [];
        const code = String(arr[idxCode] ?? "").replace(/["\s]/g, "");
        const name = String(arr[idxName] ?? "").replace(/["\s]/g, "");
        const group = String(arr[idxGroup] ?? "").replace(/["\s]/g, "");
        if (!code || !name) continue;
        const unitCost = idxCost >= 0 ? parseNumberLike(String(arr[idxCost] ?? "")) ?? undefined : undefined;
        const packSizeRaw = idxPackSize >= 0 ? parseNumberLike(String(arr[idxPackSize] ?? "")) : undefined;
        const packSize = packSizeRaw != null && packSizeRaw > 0 ? packSizeRaw : undefined;
        result.products.push({
          code,
          name,
          group,
          subGroup: idxSub >= 0 ? String(arr[idxSub] ?? "").replace(/["\s]/g, "") : "",
          spec: idxSpec >= 0 ? String(arr[idxSpec] ?? "").replace(/["\s]/g, "") : "",
          unitCost: unitCost ?? undefined,
          packSize,
        });
      }
      result.summary.productsCount = result.products.length;
    }
  }

  const year = new Date().getFullYear();
  const allTxs: CsvImportTxDraft[] = [];

  // 2. 재고 시트 (전일 재고) - 가장 먼저 반영 (품목구분, 수량(개))
  const stockSheet = findSheet(wb, ["재고", "전일재고"]);
  if (stockSheet) {
    const { headers, rows } = getSheetData(stockSheet);
    const idxGroup = findCol(headers, ["품목구분"]);
    const idxQty = findCol(headers, ["수량", "재고", "재고수량"]);
    const sumByItem: Record<ItemId, number> = {
      mask: 0, capsule: 0, fabric: 0, liquid: 0, living: 0,
    };

    if (idxGroup >= 0 && idxQty >= 0) {
      for (const row of rows) {
        const arr = Array.isArray(row) ? row : [];
        const rawGroup = String(arr[idxGroup] ?? "");
        const qty = parseNumberLike(String(arr[idxQty] ?? ""));
        if (!qty || qty < 0) continue;
        const itemId = mapGroupToItemId(rawGroup);
        sumByItem[itemId] += qty;
      }
      for (const [itemId, qty] of Object.entries(sumByItem)) {
        if (qty > 0) {
          allTxs.push({
            date: today,
            itemId: itemId as ItemId,
            type: "in",
            quantity: qty,
            person: "시스템",
            note: `현시간 재고 반영 (${file.name})`,
          });
        }
      }
      result.summary.stockCount = allTxs.length;
      result.summary.openingDate = today;
    }
  }

  // 3. 입고 시트 (입고일자, 품목구분, 수량(개), 담당자, 제품명, 매출구분)
  const inSheet = findSheet(wb, ["입고", "생산입고"]);
  if (inSheet) {
    const { headers, rows } = getSheetData(inSheet);
    const idxDate = findCol(headers, ["입고일자", "입고일", "일자"]);
    const idxGroup = findCol(headers, ["품목구분"]);
    const idxQty = findCol(headers, ["수량"]);
    const idxPerson = findCol(headers, ["생산처", "입고처", "담당자"]);
    const idxProduct = findCol(headers, ["제품명"]);
    const idxCode = findCol(headers, ["품목코드", "제품코드", "코드"]);
    const idxSalesChannel = findCol(headers, ["매출구분", "판매처"]);

    if (idxDate >= 0 && idxGroup >= 0 && idxQty >= 0) {
      for (const row of rows) {
        const arr = Array.isArray(row) ? row : [];
        const rawDate = String(arr[idxDate] ?? "");
        const rawGroup = String(arr[idxGroup] ?? "");
        const qty = parseNumberLike(String(arr[idxQty] ?? ""));
        const date = parseDate(rawDate, year) || parseKoreanDateToISO(rawDate, year);
        if (!date || !qty || qty <= 0) continue;
        const itemId = mapGroupToItemId(rawGroup);
        const person = String(arr[idxPerson ?? -1] ?? "").replace(/["\s]/g, "") || "-";
        const product = String(arr[idxProduct ?? -1] ?? "").replace(/["\s]/g, "") || "";
        const code = idxCode >= 0 ? String(arr[idxCode] ?? "").replace(/["\s]/g, "").trim() : "";
        const rawSc = idxSalesChannel >= 0 ? String(arr[idxSalesChannel] ?? "").replace(/["\s]/g, "").toLowerCase() : "";
        const salesChannel: SalesChannel | undefined = rawSc.includes("쿠팡") ? "coupang" : rawSc ? "general" : undefined;
        allTxs.push({
          date,
          itemId,
          type: "in",
          quantity: qty,
          person,
          note: product ? `CSV ${product}` : "",
          productCode: code || undefined,
          salesChannel,
        });
        result.summary.inCount++;
      }
    }
  }

  // 4. 출고 시트 (출고일자, 품목구분, 수량(개), 출고처, 제품명, 매출구분)
  const outSheet = findSheet(wb, ["출고", "이번달출고"]);
  if (outSheet) {
    const { headers, rows } = getSheetData(outSheet);
    const idxDate = findCol(headers, ["출고일자", "일자"]);
    const idxGroup = findCol(headers, ["품목구분"]);
    const idxQty = findCol(headers, ["수량"]);
    const idxPerson = findCol(headers, ["출고처", "입고처"]);
    const idxProduct = findCol(headers, ["제품명"]);
    const idxCode = findCol(headers, ["품목코드", "제품코드", "코드"]);
    const idxSalesChannel = findCol(headers, ["매출구분", "판매처"]);

    if (idxDate >= 0 && idxGroup >= 0 && idxQty >= 0) {
      for (const row of rows) {
        const arr = Array.isArray(row) ? row : [];
        const rawDate = String(arr[idxDate] ?? "");
        const rawGroup = String(arr[idxGroup] ?? "");
        const qty = parseNumberLike(String(arr[idxQty] ?? ""));
        const date = parseDate(rawDate, year) || parseKoreanDateToISO(rawDate, year);
        if (!date || !qty || qty <= 0) continue;
        const itemId = mapGroupToItemId(rawGroup);
        const person = String(arr[idxPerson ?? -1] ?? "").replace(/["\s]/g, "") || "-";
        const product = String(arr[idxProduct ?? -1] ?? "").replace(/["\s]/g, "") || "";
        const code = idxCode >= 0 ? String(arr[idxCode] ?? "").replace(/["\s]/g, "").trim() : "";
        const rawSc = idxSalesChannel >= 0 ? String(arr[idxSalesChannel] ?? "").replace(/["\s]/g, "").toLowerCase() : "";
        const salesChannel: SalesChannel | undefined = rawSc.includes("쿠팡") ? "coupang" : rawSc ? "general" : undefined;
        allTxs.push({
          date,
          itemId,
          type: "out",
          quantity: qty,
          person,
          note: product ? `CSV ${product}` : "",
          productCode: code || undefined,
          salesChannel,
        });
        result.summary.outCount++;
      }
    }
  }

  result.transactions = allTxs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return result;
}
