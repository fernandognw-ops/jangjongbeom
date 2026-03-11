import type { ItemId, ProductMasterRow, StockMap, SalesChannel } from "@/lib/types";

export interface ParsedCsvSummary {
  totalRows: number;
  usedRows: number;
  skippedRows: number;
  totalsByItem: Record<ItemId, number>;
  dateMin?: string;
  dateMax?: string;
}

export interface CsvImportTxDraft {
  date: string; // YYYY-MM-DD
  itemId: ItemId;
  type: "in" | "out";
  quantity: number;
  person: string;
  note: string;
  productName?: string; // 제품명 (제품별 집계용)
  productCode?: string; // 품목코드 (CSV에 있으면 직접 사용)
  salesChannel?: SalesChannel; // 매출구분: 쿠팡/일반
}

/** CSV를 논리적 행으로 분리 (따옴표 안의 줄바꿈 무시) */
function splitCsvIntoLogicalLines(text: string): string[] {
  const lines: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      const next = text[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      current += ch;
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      lines.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\"") {
      const next = line[i + 1];
      if (inQuotes && next === "\"") {
        cur += "\"";
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function normalizeHeader(s: string) {
  return s.replace(/\s+/g, "").replace(/"/g, "");
}

function parseNumberLike(s: string): number | null {
  const cleaned = s.replace(/["\s]/g, "").replace(/,/g, "");
  if (!cleaned) return null;
  const n = Number.parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : null;
}

function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

export function parseKoreanDateToISO(input: string, year = new Date().getFullYear()): string | null {
  const s = input.replace(/["\s]/g, "");
  const m1 = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m1) return `${m1[1]}-${m1[2]}-${m1[3]}`;
  const m2 = s.match(/^(\d{1,2})월(\d{1,2})일$/);
  if (m2) return `${year}-${pad2(Number(m2[1]))}-${pad2(Number(m2[2]))}`;
  const m3 = s.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m3) return `${year}-${pad2(Number(m3[1]))}-${pad2(Number(m3[2]))}`;
  return null;
}

export function mapGroupToItemId(group: string): ItemId {
  const g = group.replace(/\s+/g, "").toLowerCase();
  if (g.includes("마스크")) return "mask";
  if (g.includes("캡슐세제") || (g.includes("캡슐") && g.includes("세제"))) return "capsule";
  if (g.includes("섬유유연제") || g.includes("유연제")) return "fabric";
  if (g.includes("액상세제") || (g.includes("액상") && g.includes("세제"))) return "liquid";
  return "living";
}

export function parseOutboundCsv(
  csvText: string,
  fileName = "CSV"
): { txs: CsvImportTxDraft[]; summary: ParsedCsvSummary } {
  const lines = csvText.split(/\r?\n/);
  let headerIdx = -1;
  let idxDate = -1;
  let idxGroup = -1;
  let idxQty = -1;
  let idxPerson = -1;
  let idxProduct = -1;
  let idxCode = -1;

  for (let i = 0; i < Math.min(lines.length, 50); i++) {
    const cols = splitCsvLine(lines[i]);
    const norm = cols.map(normalizeHeader);
    const dateI = norm.findIndex((h) => h === "출고일자" || h === "일자");
    const groupI = norm.findIndex((h) => h === "품목구분" || h === "품목");
    const qtyI = norm.findIndex((h) => h === "수량");
    if (dateI >= 0 && groupI >= 0 && qtyI >= 0) {
      headerIdx = i;
      idxDate = dateI;
      idxGroup = groupI;
      idxQty = qtyI;
      idxPerson = norm.findIndex((h) => h === "출고처" || h === "입고처" || h === "생산처");
      idxProduct = norm.findIndex((h) => h === "제품명" || h === "상품명");
      idxCode = norm.findIndex((h) => h === "품목코드" || h === "제품코드" || h === "코드");
      break;
    }
  }

  let idxSalesChannelFound = -1;
  if (headerIdx >= 0) {
    const norm = splitCsvLine(lines[headerIdx]).map(normalizeHeader);
    idxSalesChannelFound = norm.findIndex((h) => h === "매출구분" || h === "판매처");
  }

  const totalsByItem: Record<ItemId, number> = { mask: 0, capsule: 0, fabric: 0, liquid: 0, living: 0 };
  if (headerIdx < 0) {
    return {
      txs: [],
      summary: {
        totalRows: Math.max(0, lines.length - 1),
        usedRows: 0,
        skippedRows: Math.max(0, lines.length - 1),
        totalsByItem,
      },
    };
  }

  const year = new Date().getFullYear();
  const agg = new Map<string, CsvImportTxDraft>();
  const scIdx = idxSalesChannelFound >= 0 ? idxSalesChannelFound : -1;

  let usedRows = 0;
  let skippedRows = 0;
  let dateMin: string | undefined;
  let dateMax: string | undefined;

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const cols = splitCsvLine(line);
    const rawDate = cols[idxDate] ?? "";
    const rawGroup = cols[idxGroup] ?? "";
    const rawQty = cols[idxQty] ?? "";
    const qty = parseNumberLike(rawQty);
    const date = parseKoreanDateToISO(rawDate, year);
    if (!date || !qty || qty <= 0) {
      skippedRows++;
      continue;
    }
    const itemId = mapGroupToItemId(rawGroup);
    const person = (idxPerson >= 0 ? cols[idxPerson] : "").replace(/["\s]/g, "") || "-";
    const product = (idxProduct >= 0 ? cols[idxProduct] : "").replace(/["\s]/g, "") || "";
    const code = (idxCode >= 0 ? cols[idxCode] : "").replace(/["\s]/g, "") || "";
    const rawSc = scIdx >= 0 ? String(cols[scIdx] ?? "").replace(/["\s]/g, "").toLowerCase() : "";
    const salesChannel: SalesChannel | undefined = rawSc.includes("쿠팡") ? "coupang" : rawSc ? "general" : undefined;
    const productKey = product ? product.trim() : "";
    const codeKey = code ? String(code).trim() : "";
    const key = `${date}|${itemId}|${codeKey || productKey}|${person}|${salesChannel ?? ""}`;
    const existing = agg.get(key);
    if (existing) {
      existing.quantity += qty;
    } else {
      agg.set(key, {
        date,
        itemId,
        type: "out",
        quantity: qty,
        person,
        note: `CSV(${fileName})`.trim().slice(0, 100),
        productName: productKey || undefined,
        productCode: codeKey || undefined,
        salesChannel,
      });
    }

    totalsByItem[itemId] += qty;
    usedRows++;
    if (!dateMin || date < dateMin) dateMin = date;
    if (!dateMax || date > dateMax) dateMax = date;
  }

  const txs = Array.from(agg.values()).sort((a, b) => (a.date < b.date ? 1 : -1));

  return {
    txs,
    summary: {
      totalRows: Math.max(0, lines.length - (headerIdx + 1)),
      usedRows,
      skippedRows,
      totalsByItem,
      dateMin,
      dateMax,
    },
  };
}

export function parseInboundCsv(
  csvText: string,
  fileName = "CSV"
): { txs: CsvImportTxDraft[]; summary: ParsedCsvSummary } {
  const lines = csvText.split(/\r?\n/);
  let headerIdx = -1;
  let idxDate = -1;
  let idxGroup = -1;
  let idxQty = -1;
  let idxPerson = -1;
  let idxProduct = -1;
  let idxCode = -1;

  for (let i = 0; i < Math.min(lines.length, 60); i++) {
    const cols = splitCsvLine(lines[i]);
    const norm = cols.map(normalizeHeader);
    const dateI = norm.findIndex((h) => h === "입고일자" || h === "입고일" || h === "일자");
    const groupI = norm.findIndex((h) => h === "품목구분" || h === "품목");
    const qtyI = norm.findIndex((h) => h === "수량");
    if (dateI >= 0 && groupI >= 0 && qtyI >= 0) {
      headerIdx = i;
      idxDate = dateI;
      idxGroup = groupI;
      idxQty = qtyI;
      idxPerson = norm.findIndex((h) => h === "생산처" || h === "입고처" || h === "담당자");
      idxProduct = norm.findIndex((h) => h === "제품명" || h === "상품명");
      idxCode = norm.findIndex((h) => h === "품목코드" || h === "제품코드" || h === "코드");
      break;
    }
  }

  let idxSalesChannelIn = -1;
  if (headerIdx >= 0) {
    const norm = splitCsvLine(lines[headerIdx]).map(normalizeHeader);
    idxSalesChannelIn = norm.findIndex((h) => h === "매출구분" || h === "판매처");
  }

  const totalsByItem: Record<ItemId, number> = { mask: 0, capsule: 0, fabric: 0, liquid: 0, living: 0 };
  if (headerIdx < 0) {
    return {
      txs: [],
      summary: {
        totalRows: Math.max(0, lines.length - 1),
        usedRows: 0,
        skippedRows: Math.max(0, lines.length - 1),
        totalsByItem,
      },
    };
  }

  const year = new Date().getFullYear();
  const agg = new Map<string, CsvImportTxDraft>();
  const scIdxIn = idxSalesChannelIn >= 0 ? idxSalesChannelIn : -1;

  let usedRows = 0;
  let skippedRows = 0;
  let dateMin: string | undefined;
  let dateMax: string | undefined;

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const cols = splitCsvLine(line);
    const rawDate = cols[idxDate] ?? "";
    const rawGroup = cols[idxGroup] ?? "";
    const rawQty = cols[idxQty] ?? "";
    const qty = parseNumberLike(rawQty);
    const date = parseKoreanDateToISO(rawDate, year);
    if (!date || !qty || qty <= 0) {
      skippedRows++;
      continue;
    }
    const itemId = mapGroupToItemId(rawGroup);
    const person = (idxPerson >= 0 ? cols[idxPerson] : "").replace(/["\s]/g, "") || "-";
    const product = (idxProduct >= 0 ? cols[idxProduct] : "").replace(/["\s]/g, "") || "";
    const code = (idxCode >= 0 ? cols[idxCode] : "").replace(/["\s]/g, "") || "";
    const rawSc = scIdxIn >= 0 ? String(cols[scIdxIn] ?? "").replace(/["\s]/g, "").toLowerCase() : "";
    const salesChannel: SalesChannel | undefined = rawSc.includes("쿠팡") ? "coupang" : rawSc ? "general" : undefined;
    const productKey = product ? product.trim() : "";
    const codeKey = code ? String(code).trim() : "";
    const key = `${date}|${itemId}|${codeKey || productKey}|${person}|${salesChannel ?? ""}`;
    const existing = agg.get(key);
    if (existing) {
      existing.quantity += qty;
    } else {
      agg.set(key, {
        date,
        itemId,
        type: "in",
        quantity: qty,
        person,
        note: `CSV(${fileName})`.trim().slice(0, 100),
        productName: productKey || undefined,
        productCode: codeKey || undefined,
        salesChannel,
      });
    }

    totalsByItem[itemId] += qty;
    usedRows++;
    if (!dateMin || date < dateMin) dateMin = date;
    if (!dateMax || date > dateMax) dateMax = date;
  }

  const txs = Array.from(agg.values()).sort((a, b) => (a.date < b.date ? 1 : -1));

  return {
    txs,
    summary: {
      totalRows: Math.max(0, lines.length - (headerIdx + 1)),
      usedRows,
      skippedRows,
      totalsByItem,
      dateMin,
      dateMax,
    },
  };
}

export function parseStockCsvToOpeningInbounds(
  csvText: string,
  openingDateISO: string,
  fileName = "CSV"
): { txs: CsvImportTxDraft[]; summary: ParsedCsvSummary } {
  // 전일 재고: 품목구분 + 수량 중심 (제품명/상품명 있으면 제품별 집계)
  const lines = csvText.split(/\r?\n/);
  let headerIdx = -1;
  let idxGroup = -1;
  let idxQty = -1;
  let idxProduct = -1;
  let idxCode = -1;

  for (let i = 0; i < Math.min(lines.length, 80); i++) {
    const cols = splitCsvLine(lines[i]);
    const norm = cols.map(normalizeHeader);
    const groupI = norm.findIndex((h) => h === "품목구분" || h === "품목");
    const qtyI = norm.findIndex((h) => h === "수량" || h === "재고" || h === "재고수량");
    if (groupI >= 0 && qtyI >= 0) {
      headerIdx = i;
      idxGroup = groupI;
      idxQty = qtyI;
      idxProduct = norm.findIndex((h) => h === "제품명" || h === "상품명");
      idxCode = norm.findIndex((h) => h === "품목코드" || h === "제품코드" || h === "코드");
      break;
    }
  }

  const totalsByItem: Record<ItemId, number> = { mask: 0, capsule: 0, fabric: 0, liquid: 0, living: 0 };
  if (headerIdx < 0) {
    return {
      txs: [],
      summary: {
        totalRows: Math.max(0, lines.length - 1),
        usedRows: 0,
        skippedRows: Math.max(0, lines.length - 1),
        totalsByItem,
      },
    };
  }

  let usedRows = 0;
  let skippedRows = 0;
  const sumByItem: Record<ItemId, number> = { mask: 0, capsule: 0, fabric: 0, liquid: 0, living: 0 };
  const hasProduct = idxProduct >= 0 || idxCode >= 0;
  const aggByProduct = new Map<string, { itemId: ItemId; qty: number; productName: string; productCode: string }>();

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const cols = splitCsvLine(line);
    const rawGroup = cols[idxGroup] ?? "";
    const rawQty = cols[idxQty] ?? "";
    const qty = parseNumberLike(rawQty);
    if (!qty || qty < 0) {
      skippedRows++;
      continue;
    }
    const itemId = mapGroupToItemId(rawGroup);
    sumByItem[itemId] += qty;
    usedRows++;

    if (hasProduct) {
      const productName = (idxProduct >= 0 ? cols[idxProduct] ?? "" : "").replace(/["\s]/g, "").trim() || "";
      const productCode = (idxCode >= 0 ? cols[idxCode] ?? "" : "").replace(/["\s]/g, "").trim() || "";
      const keyVal = productCode || productName;
      const key = keyVal ? `${itemId}|${keyVal}` : "";
      if (key) {
        const existing = aggByProduct.get(key);
        if (existing) {
          existing.qty += qty;
        } else {
          aggByProduct.set(key, { itemId, qty, productName, productCode });
        }
      }
    }
  }

  for (const [itemId, qty] of Object.entries(sumByItem)) {
    totalsByItem[itemId as ItemId] = qty;
  }

  const txs: CsvImportTxDraft[] = (() => {
    if (hasProduct && aggByProduct.size > 0) {
      return Array.from(aggByProduct.values()).map(({ itemId, qty, productName, productCode }) => ({
        date: openingDateISO,
        itemId,
        type: "in",
        quantity: qty,
        person: "시스템",
        note: `현시간 재고 반영 (CSV:${fileName})`,
        productName: productName || undefined,
        productCode: productCode || undefined,
      }));
    }
    return (Object.keys(sumByItem) as ItemId[])
      .filter((k) => sumByItem[k] > 0)
      .map((itemId) => ({
        date: openingDateISO,
        itemId,
        type: "in",
        quantity: sumByItem[itemId],
        person: "시스템",
        note: `현시간 재고 반영 (CSV:${fileName})`,
      }));
  })();

  return {
    txs,
    summary: {
      totalRows: Math.max(0, lines.length - (headerIdx + 1)),
      usedRows,
      skippedRows,
      totalsByItem,
      dateMin: openingDateISO,
      dateMax: openingDateISO,
    },
  };
}

/** 순수 현재고 CSV → 기초 재고 (트랜잭션 아님) */
export function parseStockCsvToBaseStock(
  csvText: string,
  products?: ProductMasterRow[]
): {
  baseStock: StockMap;
  baseStockByProduct: Record<string, number>;
  summary: ParsedCsvSummary;
} {
  const result = parseStockCsvToOpeningInbounds(csvText, "", "재고");
  const baseStock: StockMap = { mask: 0, capsule: 0, fabric: 0, liquid: 0, living: 0 };
  const baseStockByProduct: Record<string, number> = {};
  const nameToCode = new Map<string, string>();
  if (products) {
    for (const p of products) {
      const k = (p.name ?? "").replace(/\s+/g, " ").trim();
      if (k) nameToCode.set(k, p.code);
    }
  }

  if (result.txs.length > 0) {
    for (const tx of result.txs) {
      baseStock[tx.itemId] = (baseStock[tx.itemId] ?? 0) + tx.quantity;
      const code = tx.productCode ?? (tx.productName ? nameToCode.get((tx.productName ?? "").replace(/\s+/g, " ").trim()) : undefined);
      if (code) {
        baseStockByProduct[code] = (baseStockByProduct[code] ?? 0) + tx.quantity;
      }
    }
  }
  return { baseStock, baseStockByProduct, summary: result.summary };
}

export function parseRawdataProducts(csvText: string): { products: ProductMasterRow[]; totalRows: number } {
  const lines = splitCsvIntoLogicalLines(csvText);
  let headerIdx = -1;
  let idxCode = -1;
  let idxName = -1;
  let idxGroup = -1;
  let idxSub = -1;
  let idxSpec = -1;
  let idxPackSize = -1;

  let idxCost = -1;
  for (let i = 0; i < Math.min(lines.length, 80); i++) {
    const cols = splitCsvLine(lines[i]);
    const norm = cols.map(normalizeHeader);
    const codeI = norm.findIndex((h) => h === "품목코드" || h === "제품코드" || h === "코드");
    const nameI = norm.findIndex((h) => h === "제품명" || h === "상품명" || h === "품목명");
    const groupI = norm.findIndex((h) => h === "품목구분" || h === "품목");
    if (codeI >= 0 && nameI >= 0 && groupI >= 0) {
      headerIdx = i;
      idxCode = codeI;
      idxName = nameI;
      idxGroup = groupI;
      idxSub = norm.findIndex((h) => h === "하위품목");
      idxSpec = norm.findIndex((h) => h === "규격");
      idxPackSize = norm.findIndex((h) => h === "입수량" || h === "입수");
      idxCost = norm.findIndex((h) => h === "원가" || h === "단가" || h.includes("제품원가표") || h.includes("원가표"));
      break;
    }
  }

  if (headerIdx < 0) return { products: [], totalRows: Math.max(0, lines.length - 1) };

  const rows: ProductMasterRow[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const cols = splitCsvLine(line);
    const code = (cols[idxCode] ?? "").replace(/["\s]/g, "");
    const name = (cols[idxName] ?? "").replace(/["\s]/g, "");
    const group = (cols[idxGroup] ?? "").replace(/["\s]/g, "");
    if (!code || !name) continue;
    const unitCost = idxCost >= 0 ? parseNumberLike(cols[idxCost] ?? "") ?? undefined : undefined;
    const packSizeRaw = idxPackSize >= 0 ? parseNumberLike(cols[idxPackSize] ?? "") : undefined;
    const packSize = packSizeRaw != null && packSizeRaw > 0 ? packSizeRaw : undefined;
    rows.push({
      code,
      name,
      group,
      subGroup: idxSub >= 0 ? (cols[idxSub] ?? "").replace(/["\s]/g, "") : "",
      spec: idxSpec >= 0 ? (cols[idxSpec] ?? "").replace(/["\s]/g, "") : "",
      unitCost,
      packSize,
    });
  }

  return { products: rows, totalRows: Math.max(0, lines.length - (headerIdx + 1)) };
}

