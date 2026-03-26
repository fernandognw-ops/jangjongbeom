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
  OUTBOUND_DATE_HEADER_TERMS,
} from "./rules";
import { normalizeValue } from "./classifier";
import {
  normalizeSalesChannelKr,
  WAREHOUSE_COUPANG,
  WAREHOUSE_GENERAL,
  type NormalizedWarehouse,
} from "@/lib/inventoryChannels";
import { toYmd } from "@/lib/dateFormat";

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
  if (synonymsKey === "category") {
    for (const pc of (SYNONYMS.product_code ?? [])) excl.add(norm(pc));
  }
  for (let i = 0; i < row.length; i++) {
    const v = norm(String(row[i] ?? ""));
    if (excl.size > 0 && excl.has(v)) continue;
    for (const n of names) {
      const nv = norm(n);
      if (nv === v) return i;
    }
  }
  return -1;
}

function findQtyCol(row: Row): number {
  const names = SYNONYMS.quantity;
  const excl = new Set(QTY_EXCLUDE.map(norm));
  for (let i = 0; i < row.length; i++) {
    const v = norm(String(row[i] ?? ""));
    if (excl.has(v)) continue;
    for (const n of names) {
      const nv = norm(n);
      if (nv === v) return i;
    }
  }
  return -1;
}

/** 스프레드시트 하단 빈 줄 등 — 셀에 의미 있는 값이 없으면 true */
function rowHasAnyNonEmptyCell(row: Row): boolean {
  for (let c = 0; c < row.length; c++) {
    const s = String(row[c] ?? "").trim();
    if (s.length > 0 && s.toLowerCase() !== "nan") return true;
  }
  return false;
}

/**
 * 재고 시트 기준일 열 인덱스.
 * `findCol(..., "stock_date")`는 동의어 "일자"가 **입고일자** 열과 먼저 매칭되어
 * 실제 기준일(기준일자) 열을 건너뛰는 경우가 있어 전용 탐색을 사용한다.
 */
export function findStockDateColumnIndex(headerRow: Row): { index: number; headerLabel: string } {
  const cells = headerRow.map((c, i) => ({
    i,
    raw: String(c ?? "").trim(),
    n: norm(String(c ?? "")),
  }));
  const strongTerms = [...SYNONYMS.stock_date] as string[];
  for (const term of strongTerms) {
    const tn = norm(term);
    if (tn.length < 2) continue;
    for (const { i, n, raw } of cells) {
      if (!n) continue;
      /* "기준일"만 입고기준일 등과 구분 */
      if (tn === norm("기준일") && n !== tn && (n.includes("입고") || n.includes("출고"))) {
        continue;
      }
      if (n.includes(tn) || n === tn) {
        return { index: i, headerLabel: raw };
      }
    }
  }
  for (const { i, n, raw } of cells) {
    if (n === "일자" || n === "date" || n === "날짜") {
      return { index: i, headerLabel: raw };
    }
  }
  for (const { i, n, raw } of cells) {
    if (!n.includes("일자")) continue;
    if (n.includes("입고") || n.includes("출고") || n.includes("출하")) continue;
    return { index: i, headerLabel: raw };
  }
  return { index: -1, headerLabel: "" };
}

/**
 * 입고 시트 입고일 열 — 헤더 동의어 순서대로 먼저 매칭 (「일자」만 있는 경우 다른 시트보다 후순위).
 */
function findInboundDateColumnIndex(headerRow: Row): { index: number; headerLabel: string } {
  const terms = [...(SYNONYMS.inbound_date as readonly string[])];
  for (const term of terms) {
    const tn = norm(term);
    for (let i = 0; i < headerRow.length; i++) {
      const h = norm(String(headerRow[i] ?? ""));
      if (h === tn) {
        return { index: i, headerLabel: String(headerRow[i] ?? "").trim() };
      }
    }
  }
  return { index: -1, headerLabel: "" };
}

/**
 * 출고 시트 출고일 열 — `findCol(..., "outbound_date")`의 "일자"가 입고/다른 열과 먼저 맞는 문제 완화.
 */
export function findOutboundDateColumnIndex(headerRow: Row): { index: number; headerLabel: string } {
  const cells = headerRow.map((c, i) => ({
    i,
    raw: String(c ?? "").trim(),
    n: norm(String(c ?? "")),
  }));
  const strongTerms = [...OUTBOUND_DATE_HEADER_TERMS] as string[];
  for (const term of strongTerms) {
    const tn = norm(term);
    if (tn.length < 2) continue;
    for (const { i, n, raw } of cells) {
      if (!n) continue;
      if (tn === norm("기준일") && n !== tn && n.includes("입고")) continue;
      if (n.includes(tn) || n === tn) {
        return { index: i, headerLabel: raw };
      }
    }
  }
  for (const { i, n, raw } of cells) {
    if (n === "일자" || n === "date" || n === "날짜") {
      return { index: i, headerLabel: raw };
    }
  }
  for (const { i, n, raw } of cells) {
    if (!n.includes("일자")) continue;
    if (n.includes("입고")) continue;
    return { index: i, headerLabel: raw };
  }
  return { index: -1, headerLabel: "" };
}

function isInvalidTotalHeader(header: string): boolean {
  const n = norm(header || "");
  return n.includes(norm("단가")) || n.includes(norm("원가"));
}

/**
 * 출고 합계 금액 열 전용 탐색.
 * - 단가/원가 헤더는 무조건 제외
 * - 우선순위: 합계* > 총금액/출고금액/판매금액 > 기타 후보
 */
function findOutboundTotalAmountColumnIndex(headerRow: Row): { index: number; headerLabel: string } {
  const candidates = (SYNONYMS.total_price_outbound ?? []).map((c) => norm(c));
  for (let i = 0; i < headerRow.length; i++) {
    const raw = String(headerRow[i] ?? "").trim();
    const n = norm(raw);
    if (!n) continue;
    if (isInvalidTotalHeader(raw)) continue;
    if (candidates.includes(n)) {
      return { index: i, headerLabel: raw };
    }
  }
  return { index: -1, headerLabel: "" };
}

function parseDate(
  val: unknown,
  year: number,
  fallback: string | null
): string | null {
  if (val == null) return fallback;
  if (typeof val === "object" && "getFullYear" in val) {
    const d = val as Date;
    const y = d.getFullYear();
    if (y < 2000 || y > 2030) return fallback;
    const ymd = toYmd(d);
    if (!ymd) return fallback;
    const [, mo, day] = ymd.split("-");
    return `${y}-${mo}-${day}`;
  }
  if (typeof val === "number" && Number.isFinite(val) && val > 0) {
    try {
      const parsed = XLSX.SSF?.parse_date_code?.(val);
      if (parsed?.y && parsed?.m && parsed?.d) {
        const y = parsed.y;
        if (y < 2000 || y > 2030) return fallback;
        return `${y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
      }
      const excelEpoch = new Date(1899, 11, 30);
      const jsDate = new Date(excelEpoch.getTime() + val * 86400 * 1000);
      const y = jsDate.getFullYear();
      if (y < 2000 || y > 2030) return fallback;
      const ymd = toYmd(jsDate);
      if (!ymd) return fallback;
      const [, mo, day] = ymd.split("-");
      return `${y}-${mo}-${day}`;
    } catch {
      return fallback;
    }
  }
  const s = String(val).trim();
  if (!s) return fallback;
  // month-only 문자열은 엄격하게 실패(날짜 기본값 주입 금지)
  if (/^(\d{4})[-_.](\d{2})$/.test(s)) return fallback;
  if (s.length >= 10 && s[4] === "-" && s[7] === "-") return s.slice(0, 10);
  const m = s.match(/^(\d{2,4})년?\s*(\d{2})\.?(\d{2})?/);
  if (m) {
    if (m[1].length !== 4) return fallback; // 연도 기본값 대체 금지
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    if (!m[3]) return fallback; // 일 기본값 대체 금지
    const d = parseInt(m[3], 10);
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  try {
    const dt = new Date(val as string | number);
    if (!isNaN(dt.getTime())) {
      const ymd = toYmd(dt);
      if (ymd) return ymd;
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

/**
 * 파일명에서 YYYY-MM-DD 또는 YYYYMMDD 추출 (없으면 undefined).
 * 재고 기준일 셀이 비어 있을 때 snapshot_date 폴백으로 사용.
 * - YYYY-MM (일 없음) → 해당월 1일로 간주
 */
export function defaultDateFromFilename(filename: string | undefined): string | undefined {
  if (!filename) return undefined;
  const name = filename.split(/[/\\]/).pop() ?? "";
  const m1 = name.match(/(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})/);
  if (m1) return `${m1[1]}-${m1[2]}-${m1[3]}`;
  const m2 = name.match(/(\d{8})/);
  if (m2) {
    const s = m2[1];
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  /** YYYY-MM 또는 YYYY.MM (같은 줄에서 일자 없음) — 과거 월 파일명 */
  const ym = name.match(/(\d{4})[-_.](\d{2})(?![-_.]?\d{2})/);
  if (ym) return `${ym[1]}-${ym[2]}-01`;
  /** 25년 3월, 2025년03월 등 */
  const kor = name.match(/(\d{2,4})년\s*(\d{1,2})월/);
  if (kor) {
    let y = parseInt(kor[1], 10);
    if (y < 100) y += y < 50 ? 2000 : 1900;
    const mo = parseInt(kor[2], 10);
    if (mo >= 1 && mo <= 12) return `${y}-${String(mo).padStart(2, "0")}-01`;
  }
  /** YY-MM (예: 25-04) — 연도 4자리 패턴보다 뒤에서 시도 */
  const yyDashMm = name.match(/(?:^|[^\d])(\d{2})-(\d{2})(?:[^\d]|$)/);
  if (yyDashMm) {
    let y = parseInt(yyDashMm[1], 10);
    if (y < 100) y += y < 50 ? 2000 : 1900;
    const mo = parseInt(yyDashMm[2], 10);
    if (mo >= 1 && mo <= 12) return `${y}-${String(mo).padStart(2, "0")}-01`;
  }
  return undefined;
}

/**
 * 파일명에서 YYYY-MM (달) 추출 — 검증용. full date·년월 패턴·한글 년월
 */
export function monthYearFromFilename(filename: string | undefined): string | undefined {
  const full = defaultDateFromFilename(filename);
  if (full) return full.slice(0, 7);
  if (!filename) return undefined;
  const name = filename.split(/[/\\]/).pop() ?? "";
  const kor = name.match(/(\d{2,4})년\s*(\d{1,2})월/);
  if (kor) {
    let y = parseInt(kor[1], 10);
    if (y < 100) y += y < 50 ? 2000 : 1900;
    const mo = parseInt(kor[2], 10);
    if (mo >= 1 && mo <= 12) return `${y}-${String(mo).padStart(2, "0")}`;
  }
  const ym = name.match(/(\d{4})[-_.](\d{2})(?![-_.]?\d{2})/);
  if (ym) return `${ym[1]}-${ym[2]}`;
  const yyDashMm = name.match(/(?:^|[^\d])(\d{2})-(\d{2})(?:[^\d]|$)/);
  if (yyDashMm) {
    let y = parseInt(yyDashMm[1], 10);
    if (y < 100) y += y < 50 ? 2000 : 1900;
    const mo = parseInt(yyDashMm[2], 10);
    if (mo >= 1 && mo <= 12) return `${y}-${String(mo).padStart(2, "0")}`;
  }
  return undefined;
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
  /** 입고센터(물류) — 집계 축 아님 */
  inbound_center: string;
  inbound_date: string;
  /** 판매채널 정규화 (쿠팡|일반) */
  warehouse_group: string;
  sales_channel: "coupang" | "general";
  channel: NormalizedWarehouse;
  event_type: "inbound";
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
  /** 정규화 판매채널 ("쿠팡" | "일반") — sales_channel 기준 */
  channel: NormalizedWarehouse;
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
  sales_channel: "coupang" | "general";
  channel: NormalizedWarehouse;
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
  if (data.length <= HEADER_ROW) throw new Error("[parseInboundSheet] 입고 시트에 헤더 행이 없습니다.");
  const headerRow = data[HEADER_ROW] ?? [];
  const idxCode = findCol(headerRow, "product_code");
  const idxName = findCol(headerRow, "product_name");
  const idxQty = findQtyCol(headerRow);
  const { index: idxDate } = findInboundDateColumnIndex(headerRow);
  const idxSalesCh = findCol(headerRow, "inbound_sales_channel");
  const idxCenter = findCol(headerRow, "inbound_center"); // optional

  if (idxCode < 0) {
    throw new Error(
      `[parseInboundSheet] 입고 시트: 품목코드 열 없음 (다음 중 하나 필요: ${(SYNONYMS.product_code as string[]).join(", ")})`
    );
  }
  if (idxName < 0) {
    throw new Error(
      `[parseInboundSheet] 입고 시트: 품목명 열 없음 (다음 중 하나: ${(SYNONYMS.product_name as string[]).join(", ")})`
    );
  }
  if (idxQty < 0) throw new Error(`[parseInboundSheet] 입고 시트: 수량 열 없음`);
  if (idxDate < 0) {
    throw new Error(
      `[parseInboundSheet] 입고 시트: 입고일자 열 없음 (다음 중 하나: ${(SYNONYMS.inbound_date as string[]).join(", ")})`
    );
  }
  if (idxSalesCh < 0) {
    throw new Error(
      `[parseInboundSheet] 입고 시트: 판매 채널 열 없음 (다음 중 하나: ${(SYNONYMS.inbound_sales_channel as string[]).join(", ")})`
    );
  }

  const year = yearFromFilename(filename);
  const rows: InboundRow[] = [];

  for (let i = DATA_START_ROW; i < data.length; i++) {
    const row = (data[i] ?? []) as Row;
    const code = String(row[idxCode] ?? "").trim();
    const name = String(row[idxName] ?? "").trim();
    const qty = safeInt(row[idxQty]);
    const dateVal = row[idxDate];
    const dateStr = parseDate(dateVal, year, null);
    const salesRaw = String(row[idxSalesCh] ?? "").trim();
    const centerRaw = idxCenter >= 0 ? String(row[idxCenter] ?? "").trim() : "";

    if (!code || code.toLowerCase() === "nan") {
      if (!rowHasAnyNonEmptyCell(row)) continue;
      throw new Error(`[parseInboundSheet] 입고 시트: 품목코드 비어있음 (row=${i})`);
    }
    if (!name || name.toLowerCase() === "nan") throw new Error(`[parseInboundSheet] 입고 시트: 품목명 비어있음 (row=${i})`);
    if (code.includes("합계") || code.includes("소계")) throw new Error(`[parseInboundSheet] 입고 시트: 품목코드가 합계/소계로 보입니다 (row=${i}, code=${code})`);
    if (qty <= 0) throw new Error(`[parseInboundSheet] 입고 시트: 수량 <= 0 (row=${i}, qty=${qty})`);
    if (!dateStr) throw new Error(`[parseInboundSheet] 입고 시트: 입고일자 비어있거나 형식 오류 (row=${i})`);
    if (salesRaw !== "쿠팡" && salesRaw !== "일반") throw new Error(`[parseInboundSheet] 입고 시트: 판매 채널 값 오류 (row=${i}, value=${salesRaw})`);

    const channelKr: NormalizedWarehouse = salesRaw === "쿠팡" ? WAREHOUSE_COUPANG : WAREHOUSE_GENERAL;
    const sales_channel: "coupang" | "general" = salesRaw === "쿠팡" ? "coupang" : "general";

    rows.push({
      product_code: code,
      product_name: name,
      quantity: qty,
      inbound_center: centerRaw,
      inbound_date: dateStr,
      warehouse_group: channelKr,
      sales_channel,
      channel: channelKr,
      event_type: "inbound",
    });
  }
  return rows;
}

/** 출고 시트 출고일 열·샘플 (검증/로그용) */
export interface OutboundSheetDateDiagnostics {
  outboundDateColumnIndex: number;
  outboundDateColumnHeader: string;
  outboundDateColumnFound: boolean;
  /** 「판매 채널」 열 인덱스 (-1 = 미발견) */
  outboundSalesChannelColumnIndex: number;
  outboundSalesChannelColumnHeader: string;
  outboundSalesChannelColumnFound: boolean;
  /** 「합계 금액」(출고 총액) 열 인덱스 */
  outboundTotalAmountColumnIndex: number;
  outboundTotalAmountColumnHeader: string;
  outboundTotalAmountColumnFound: boolean;
  /** 헤더 원문/정규화 전체 목록 (컬럼 인식 문제 진단용) */
  outboundHeaderRowRaw: string[];
  outboundHeaderRowNormalized: string[];
  /** 판매 채널 컬럼 원문 distinct (trim 전/후) */
  outboundSalesChannelDistinctRaw: string[];
  outboundSalesChannelDistinctTrimmed: string[];
  /** 판매 채널 매핑 디버그 샘플 */
  outboundSalesChannelSamples: Array<{
    rowIndex: number;
    rawBeforeTrim: string;
    rawAfterTrim: string;
    mappedChannelKr: string;
    channel: NormalizedWarehouse;
  }>;
  outboundTotalAmountSamples: Array<{
    rowIndex: number;
    rawCell: unknown;
    parsedAmount: number;
    invalidBySanity: boolean;
  }>;
  samples: Array<{ rowIndex: number; rawCell: unknown; parsedDate: string }>;
}

export function parseOutboundSheet(
  data: unknown[][],
  filename?: string,
  sheetName = "출고"
): { rows: OutboundRow[]; dateDiagnostics: OutboundSheetDateDiagnostics } {
  const emptyDiag = (): OutboundSheetDateDiagnostics => ({
    outboundDateColumnIndex: -1,
    outboundDateColumnHeader: "",
    outboundDateColumnFound: false,
    outboundSalesChannelColumnIndex: -1,
    outboundSalesChannelColumnHeader: "",
    outboundSalesChannelColumnFound: false,
    outboundTotalAmountColumnIndex: -1,
    outboundTotalAmountColumnHeader: "",
    outboundTotalAmountColumnFound: false,
    outboundHeaderRowRaw: [],
    outboundHeaderRowNormalized: [],
    outboundSalesChannelDistinctRaw: [],
    outboundSalesChannelDistinctTrimmed: [],
    outboundSalesChannelSamples: [],
    outboundTotalAmountSamples: [],
    samples: [],
  });

  if (data.length <= HEADER_ROW) {
    throw new Error("[parseOutboundSheet] 출고 시트에 헤더 행이 없습니다.");
  }
  const headerRow = data[HEADER_ROW] ?? [];
  const idxCode = findCol(headerRow, "product_code");
  const idxName = findCol(headerRow, "product_name");
  const idxQty = findQtyCol(headerRow);
  const idxCenter = findCol(headerRow, "outbound_center"); // optional
  const { index: idxDate, headerLabel: outboundDateHeader } = findOutboundDateColumnIndex(headerRow);
  const idxSc = findCol(headerRow, "outbound_sales_channel");
  if (idxSc === -1) {
    throw new Error(
      `출고 시트에서 판매 채널 열을 찾지 못함 (다음 중 하나 필요: ${(SYNONYMS.outbound_sales_channel as string[]).join(", ")})`
    );
  }
  const outboundSalesChannelHeader = String(headerRow[idxSc] ?? "").trim();
  const outboundHeaderRowRaw = headerRow.map((h) => String(h ?? ""));
  const outboundHeaderRowNormalized = outboundHeaderRowRaw.map((h) => norm(h));
  const idxCat = findCol(headerRow, "category");
  const idxPack = findCol(headerRow, "pack_size");
  const idxUnit = findCol(headerRow, "unit_price");
  const { index: idxTotal, headerLabel: outboundTotalAmountHeader } = findOutboundTotalAmountColumnIndex(headerRow);

  if (idxCode < 0) {
    throw new Error(`출고 시트: 품목코드 열 없음 (다음 중 하나: ${(SYNONYMS.product_code as string[]).join(", ")})`);
  }
  if (idxName < 0) {
    throw new Error(`출고 시트: 품목명 열 없음 (다음 중 하나: ${(SYNONYMS.product_name as string[]).join(", ")})`);
  }
  if (idxQty < 0) throw new Error("출고 시트: 수량 열 없음");
  if (idxDate < 0) throw new Error("출고 시트: 출고일자 열 없음 (출고일자·출고일·기준일자 등)");

  const year = yearFromFilename(filename);
  const rows: OutboundRow[] = [];
  const samples: OutboundSheetDateDiagnostics["samples"] = [];
  const maxSamples = 5;
  const rawSet = new Set<string>();
  const trimmedSet = new Set<string>();
  const outboundSalesChannelSamples: OutboundSheetDateDiagnostics["outboundSalesChannelSamples"] = [];
  const outboundTotalAmountSamples: OutboundSheetDateDiagnostics["outboundTotalAmountSamples"] = [];
  const maxChannelSamples = 20;

  for (let i = DATA_START_ROW; i < data.length; i++) {
    const row = (data[i] ?? []) as Row;
    const code = String(row[idxCode] ?? "").trim();
    const qty = safeInt(row[idxQty]);
    const dateVal = row[idxDate];
    const outbound_date = parseDate(dateVal, year, null);
    const name = String(row[idxName] ?? "").trim();
    const salesRawCell = String(row[idxSc] ?? "").trim();

    if (!code || code.toLowerCase() === "nan") {
      if (!rowHasAnyNonEmptyCell(row)) continue;
      throw new Error(`출고 시트: 품목코드 비어있음 (row=${i})`);
    }
    if (!name || name.toLowerCase() === "nan") throw new Error(`출고 시트: 품목명 비어있음 (row=${i})`);
    if (qty <= 0) throw new Error(`출고 시트: 수량 <= 0 (row=${i}, qty=${qty})`);
    if (!outbound_date) throw new Error(`출고 시트: 출고일자 비어있거나 형식 오류 (row=${i})`);
    if (salesRawCell !== "쿠팡" && salesRawCell !== "일반")
      throw new Error(`출고 시트: 판매 채널 값 오류 (row=${i}, value=${salesRawCell})`);

    if (samples.length < maxSamples) {
      samples.push({
        rowIndex: i,
        rawCell: dateVal,
        parsedDate: outbound_date,
      });
    }

    const centerRaw = idxCenter >= 0 ? String(row[idxCenter] ?? "").trim() : "";
    const scRawBeforeTrim = String(row[idxSc] ?? "");
    const scRaw = scRawBeforeTrim.trim();
    if (scRaw !== "쿠팡" && scRaw !== "일반") {
      throw new Error(`잘못된 판매 채널 값: ${scRaw}`);
    }
    if (rawSet.size < 200) rawSet.add(scRawBeforeTrim);
    if (trimmedSet.size < 200) trimmedSet.add(scRaw);
    const channelKr = scRaw === "쿠팡" ? WAREHOUSE_COUPANG : WAREHOUSE_GENERAL;
    const sales_channel: "coupang" | "general" =
      channelKr === WAREHOUSE_COUPANG ? "coupang" : "general";
    const channel: NormalizedWarehouse =
      sales_channel === "coupang" ? WAREHOUSE_COUPANG : WAREHOUSE_GENERAL;
    if (outboundSalesChannelSamples.length < maxChannelSamples) {
      outboundSalesChannelSamples.push({
        rowIndex: i,
        rawBeforeTrim: scRawBeforeTrim,
        rawAfterTrim: scRaw,
        mappedChannelKr: scRaw,
        channel,
      });
    }
    const cat = idxCat >= 0 ? String(row[idxCat] ?? "").trim() : "";
    const pack = idxPack >= 0 ? safeInt(row[idxPack]) : undefined;
    const unit = idxUnit >= 0 ? safeFloat(row[idxUnit]) : 0;
    const totalRaw = idxTotal >= 0 ? safeFloat(row[idxTotal]) : 0;
    const expectedLine = unit * qty;
    // 기존 `totalRaw < unit*1.2` 는 수량 1(합계≈단가)인 정상 행에서 항상 오탐 → 단가×수량 대비 과소만 검사
    const invalidBySanity =
      unit > 0 &&
      totalRaw > 0 &&
      qty > 0 &&
      expectedLine > 0 &&
      totalRaw + 1e-6 < expectedLine * 0.85;
    if (invalidBySanity) {
      throw new Error(
        `[parseOutboundSheet] 출고 합계 금액이 단가×수량과 불일치 (row=${i}, unit=${unit}, qty=${qty}, total=${totalRaw}, 단가×수량=${expectedLine})`
      );
    }
    const total = totalRaw;
    if (outboundTotalAmountSamples.length < maxChannelSamples) {
      outboundTotalAmountSamples.push({
        rowIndex: i,
        rawCell: idxTotal >= 0 ? row[idxTotal] : null,
        parsedAmount: total,
        invalidBySanity,
      });
    }

    rows.push({
      product_code: code,
      product_name: name,
      quantity: qty,
      outbound_center: centerRaw,
      outbound_date,
      warehouse_group: channelKr,
      sales_channel,
      channel,
      event_type: "outbound",
      // 출고는 의미 분리: sales_channel=판매채널, dest_warehouse=출고센터
      dest_warehouse: centerRaw || undefined,
      category: cat || undefined,
      pack_size: idxPack >= 0 && pack && pack > 0 ? pack : undefined,
      unit_price: idxUnit >= 0 ? unit : undefined,
      total_price: idxTotal >= 0 ? total : undefined,
    });
  }

  const dateDiagnostics: OutboundSheetDateDiagnostics = {
    outboundDateColumnIndex: idxDate,
    outboundDateColumnHeader: outboundDateHeader,
    outboundDateColumnFound: idxDate >= 0,
    outboundSalesChannelColumnIndex: idxSc,
    outboundSalesChannelColumnHeader: outboundSalesChannelHeader,
    outboundSalesChannelColumnFound: true,
    outboundTotalAmountColumnIndex: idxTotal,
    outboundTotalAmountColumnHeader: outboundTotalAmountHeader,
    outboundTotalAmountColumnFound: idxTotal >= 0,
    outboundHeaderRowRaw,
    outboundHeaderRowNormalized,
    outboundSalesChannelDistinctRaw: [...rawSet].sort(),
    outboundSalesChannelDistinctTrimmed: [...trimmedSet].sort(),
    outboundSalesChannelSamples,
    outboundTotalAmountSamples,
    samples,
  };

  console.log(
    "[parseOutboundSheet:outbound-date]",
    JSON.stringify({
      sheet: sheetName,
      filename: filename ?? "",
      outboundDateColumnIndex: idxDate,
      outboundDateColumnHeader: outboundDateHeader,
      outboundSalesChannelColumnIndex: idxSc,
      outboundSalesChannelColumnHeader: outboundSalesChannelHeader,
      outboundTotalAmountColumnIndex: idxTotal,
      outboundTotalAmountColumnHeader: outboundTotalAmountHeader,
      detectedOutboundSalesChannelHeader: outboundSalesChannelHeader || null,
      detectedOutboundTotalAmountHeader: outboundTotalAmountHeader || null,
      outboundHeaderRowRaw,
      outboundHeaderRowNormalized,
      outboundSalesChannelDistinctRaw: dateDiagnostics.outboundSalesChannelDistinctRaw,
      outboundSalesChannelDistinctTrimmed: dateDiagnostics.outboundSalesChannelDistinctTrimmed,
      outboundSalesChannelSamples: dateDiagnostics.outboundSalesChannelSamples.slice(0, 20),
      outboundSalesChannelRowValueSamples: dateDiagnostics.outboundSalesChannelSamples
        .slice(0, 20)
        .map((s) => ({
          rowIndex: s.rowIndex,
          excelSalesChannelRawCell: s.rawBeforeTrim,
          parserReadValue: s.rawAfterTrim,
        })),
      outboundTotalAmountSamples: dateDiagnostics.outboundTotalAmountSamples.slice(0, 20),
      samples: samples.slice(0, 5),
    })
  );

  return { rows, dateDiagnostics };
}

/** 재고 시트 기준일 열 인식·샘플 (검증/로그용) */
export interface StockSheetDateDiagnostics {
  stockDateColumnIndex: number;
  stockDateColumnHeader: string;
  stockDateColumnFound: boolean;
  fileDefaultDate: string;
  filenameExtractedDate: string | undefined;
  yearFromFilenameHint: number;
  samples: Array<{
    rowIndex: number;
    rawCell: unknown;
    parsedDate: string;
    finalSnapshotDate: string;
  }>;
}

export function parseStockSheet(
  data: unknown[][],
  filename?: string,
  sheetName = "재고"
): { rows: StockRow[]; dateDiagnostics: StockSheetDateDiagnostics } {
  const emptyDiag = (fd: string, fn: string | undefined, y: number): StockSheetDateDiagnostics => ({
    stockDateColumnIndex: -1,
    stockDateColumnHeader: "",
    stockDateColumnFound: false,
    fileDefaultDate: fd,
    filenameExtractedDate: fn,
    yearFromFilenameHint: y,
    samples: [],
  });

  if (data.length <= HEADER_ROW) {
    throw new Error("[parseStockSheet] 재고 시트에 헤더 행이 없습니다.");
  }
  const headerRow = data[HEADER_ROW] ?? [];
  const idxCode = findCol(headerRow, "product_code");
  const idxName = findCol(headerRow, "product_name");
  const idxQty = findQtyCol(headerRow);
  const idxCenter = findCol(headerRow, "storage_center"); // optional
  const idxSalesCh = findCol(headerRow, "stock_sales_channel"); // required
  const { index: idxDate, headerLabel: stockDateHeaderLabel } = findStockDateColumnIndex(headerRow);

  const idxCost = findCol(headerRow, "unit_cost");
  const idxTotal = findCol(headerRow, "total_price");
  const idxCat = findCol(headerRow, "category");
  const idxPack = findCol(headerRow, "pack_size");

  const year = yearFromFilename(filename);
  const today = new Date().toISOString().slice(0, 10);
  const filenameDay = defaultDateFromFilename(filename);
  // 진단용(실제 파싱 보정엔 사용하지 않음)
  const fileDefaultDate = filenameDay ?? today;

  if (idxCode < 0) {
    throw new Error(
      `[parseStockSheet] 재고 시트: 품목코드 열 없음 (다음 중 하나: ${(SYNONYMS.product_code as string[]).join(", ")})`
    );
  }
  if (idxName < 0) {
    throw new Error(
      `[parseStockSheet] 재고 시트: 품목명 열 없음 (다음 중 하나: ${(SYNONYMS.product_name as string[]).join(", ")})`
    );
  }
  if (idxQty < 0) throw new Error("[parseStockSheet] 재고 시트: 수량 열 없음");
  if (idxSalesCh < 0) {
    throw new Error(
      `[parseStockSheet] 재고 시트: 판매 채널 열 없음 (다음 중 하나: ${(SYNONYMS.stock_sales_channel as string[]).join(", ")})`
    );
  }
  if (idxDate < 0) throw new Error("[parseStockSheet] 재고 시트: 기준일자(재고 기준일) 열 없음");

  const rows: StockRow[] = [];
  const samples: StockSheetDateDiagnostics["samples"] = [];
  const maxSamples = 5;

  for (let i = DATA_START_ROW; i < data.length; i++) {
    const row = (data[i] ?? []) as Row;
    const code = String(row[idxCode] ?? "").trim();
    if (!code || code.toLowerCase() === "nan") {
      if (!rowHasAnyNonEmptyCell(row)) continue;
      throw new Error(`[parseStockSheet] 재고 시트: 품목코드 비어있음 (row=${i})`);
    }

    const qty = safeInt(row[idxQty]);
    if (qty < 0) throw new Error(`[parseStockSheet] 재고 시트: 수량 < 0 (row=${i}, qty=${qty})`);
    const name = idxName >= 0 ? String(row[idxName] ?? "").trim() : "";
    if (!name || name.toLowerCase() === "nan") {
      throw new Error(`[parseStockSheet] 재고 시트: 품목명 비어있음 (row=${i})`);
    }
    const storageRaw = idxCenter >= 0 ? String(row[idxCenter] ?? "").trim() : "";
    const salesChannelRaw = idxSalesCh >= 0 ? String(row[idxSalesCh] ?? "").trim() : "";
    if (salesChannelRaw !== "쿠팡" && salesChannelRaw !== "일반") {
      throw new Error(`[parseStockSheet] 재고 시트: 판매 채널 값 오류 (row=${i}, value=${salesChannelRaw})`);
    }
    const sales_channel: "coupang" | "general" =
      salesChannelRaw === "쿠팡" ? "coupang" : "general";
    const channelKr: NormalizedWarehouse =
      salesChannelRaw === "쿠팡" ? WAREHOUSE_COUPANG : WAREHOUSE_GENERAL;
    const dateVal = idxDate >= 0 ? row[idxDate] : undefined;
    const dateStr = parseDate(dateVal, year, null);
    if (!dateStr) {
      throw new Error(`[parseStockSheet] 재고 시트: 기준일자 비어있거나 형식 오류 (row=${i})`);
    }
    const finalSnap = dateStr.slice(0, 10);
    const cost = idxCost >= 0 ? safeFloat(row[idxCost]) : 0;
    const total = idxTotal >= 0 ? safeFloat(row[idxTotal]) : 0;
    const cat = idxCat >= 0 ? String(row[idxCat] ?? "").trim() : "";
    const pack = idxPack >= 0 ? safeInt(row[idxPack]) : undefined;

    if (samples.length < maxSamples) {
      samples.push({
        rowIndex: i,
        rawCell: dateVal,
        parsedDate: dateStr,
        finalSnapshotDate: finalSnap,
      });
    }

    rows.push({
      product_code: code,
      product_name: name,
      quantity: qty,
      storage_center: storageRaw,
      stock_date: dateStr,
      warehouse_group: channelKr,
      event_type: "stock",
      sales_channel,
      channel: channelKr,
      unit_cost: cost,
      total_price: total > 0 ? total : 0,
      snapshot_date: finalSnap,
      category: cat || undefined,
      pack_size: typeof pack === "number" && pack > 0 ? pack : undefined,
    });
  }

  const dateDiagnostics: StockSheetDateDiagnostics = {
    stockDateColumnIndex: idxDate,
    stockDateColumnHeader: stockDateHeaderLabel,
    stockDateColumnFound: idxDate >= 0,
    fileDefaultDate,
    filenameExtractedDate: filenameDay,
    yearFromFilenameHint: year,
    samples,
  };

  console.log(
    "[parseStockSheet:stock-date]",
    JSON.stringify({
      sheet: sheetName,
      filename: filename ?? "",
      stockDateColumnIndex: idxDate,
      stockDateColumnHeader: stockDateHeaderLabel,
      filenameExtractedDate: filenameDay ?? null,
      fileDefaultDate,
      samples: samples.slice(0, 3),
    })
  );

  return { rows, dateDiagnostics };
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
  if (data.length <= HEADER_ROW) {
    throw new Error("[parseRawdataSheet] rawdata 시트에 헤더 행이 없습니다.");
  }

  const requiredHeaders = ["품목코드", "품목명", "원가"];
  let headerIndex = -1;
  let headerRow: Row = [];
  for (let r = 0; r < Math.min(10, data.length); r++) {
    const candidate = (data[r] ?? []) as Row;
    const hasAll = requiredHeaders.every((want) =>
      candidate.some((c) => String(c ?? "").trim() === want)
    );
    if (hasAll) {
      headerIndex = r;
      headerRow = candidate;
      break;
    }
  }
  if (headerIndex < 0) {
    throw new Error("[parseRawdataSheet] rawdata 시트에서 필수 헤더(품목코드/품목명/원가)를 찾지 못했습니다.");
  }

  const idxCode = headerRow.findIndex((h) => String(h ?? "").trim() === "품목코드");
  const idxName = headerRow.findIndex((h) => String(h ?? "").trim() === "품목명");
  const idxCost = headerRow.findIndex((h) => String(h ?? "").trim() === "원가");
  if (idxCode < 0 || idxName < 0 || idxCost < 0) {
    throw new Error("[parseRawdataSheet] rawdata 시트 필수 헤더 인덱스 계산 실패");
  }

  const rows: RawdataRow[] = [];
  for (let i = headerIndex + 1; i < data.length; i++) {
    const row = (data[i] ?? []) as Row;
    const code = String(row[idxCode] ?? "").trim();
    const name = String(row[idxName] ?? "").trim();
    const costRaw = String(row[idxCost] ?? "").trim();

    if (!code || code.toLowerCase() === "nan") {
      throw new Error(`[parseRawdataSheet] rawdata 시트: 품목코드 비어있음 (row=${i})`);
    }
    if (!name || name.toLowerCase() === "nan") {
      throw new Error(`[parseRawdataSheet] rawdata 시트: 품목명 비어있음 (row=${i})`);
    }
    if (!costRaw || costRaw.toLowerCase() === "nan") {
      throw new Error(`[parseRawdataSheet] rawdata 시트: 원가 비어있음 (row=${i})`);
    }

    const cost = parseFloat(String(costRaw ?? "").replace(/,/g, ""));
    if (!Number.isFinite(cost)) {
      throw new Error(`[parseRawdataSheet] rawdata 시트: 원가 숫자 형식 오류 (row=${i}, value=${costRaw})`);
    }
    if (cost < 0) {
      throw new Error(`[parseRawdataSheet] rawdata 시트: 원가 0 미만 (row=${i}, value=${cost})`);
    }

    rows.push({
      product_code: code,
      product_name: name,
      unit_cost: cost,
    });
  }

  return rows;
}

export interface RawdataRow {
  product_code: string;
  product_name: string;
  unit_cost: number;
  category?: string;
  pack_size?: number;
}

/** 재고 시트 헤더(2행)만 보고 「판매 채널」열 인식 여부 — DB NULL 원인 진단용 */
export function inspectStockSheetHeaders(data: unknown[][]): { salesChannelColumnFound: boolean; salesChannelColumnIndex: number } {
  if (data.length <= HEADER_ROW) {
    return { salesChannelColumnFound: false, salesChannelColumnIndex: -1 };
  }
  const headerRow = (data[HEADER_ROW] ?? []) as Row;
  const idx = headerRow.findIndex((h) => String(h ?? "").trim() === "판매 채널");
  return { salesChannelColumnFound: idx >= 0, salesChannelColumnIndex: idx };
}

export interface ParseResult {
  ok: true;
  inbound: InboundRow[];
  outbound: OutboundRow[];
  stock: StockRow[];
  rawdata: RawdataRow[];
  sheetNames: string[];
  /** 출고 시트 원본 데이터 행 수 (필터 전, 0-indexed DATA_START_ROW 이후) */
  outboundRawRowCount?: number;
  /** 재고 시트에서 SYNONYMS.stock_sales_channel 매칭 열을 찾았는지 (false면 전부 일반으로만 파싱됨) */
  stockSheetDiagnostics?: { salesChannelColumnFound: boolean; salesChannelColumnIndex: number };
  /** 재고 기준일 열 인덱스·샘플 (입고일자 오매칭 방지 등) */
  stockDateDiagnostics?: StockSheetDateDiagnostics;
  /** 출고 시트 출고일 열·샘플 */
  outboundDateDiagnostics?: OutboundSheetDateDiagnostics;
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
    sheetNames.some((s) => norm(s) === norm(name));

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
      (s) => norm(s) === norm(name)
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
      const found = sheetNames.find((s) => norm(s) === norm(want));
      if (found) return found;
    }
    return null;
  };

  try {
    const inboundData = getSheetData("입고");
    const outboundData = getSheetData("출고");
    const stockData = getSheetData("재고");

    const inbound = parseInboundSheet(inboundData, filename);
    const { rows: outbound, dateDiagnostics: outboundDateDiagnostics } = parseOutboundSheet(outboundData, filename);
    const { rows: stock, dateDiagnostics: stockDateDiagnostics } = parseStockSheet(stockData, filename);
    const stockSheetDiagnostics = inspectStockSheetHeaders(stockData);
    const outboundRawRowCount = Math.max(0, outboundData.length - DATA_START_ROW);

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
      outboundRawRowCount,
      stockSheetDiagnostics,
      stockDateDiagnostics,
      outboundDateDiagnostics,
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
