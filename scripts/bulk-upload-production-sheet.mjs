#!/usr/bin/env node
/**
 * 1년치 생산수불현황 Excel → Supabase Bulk Upload
 *
 * 사용법:
 *   node scripts/bulk-upload-production-sheet.mjs "경로/생산수불현황.xlsx"
 *
 * .env.local 로드 후 API 호출 (npm run dev 실행 중이어야 함)
 */

import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";
import XLSX from "xlsx";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function loadEnv() {
  const envPath = join(root, ".env.local");
  if (!existsSync(envPath)) {
    console.error("오류: .env.local이 없습니다.");
    process.exit(1);
  }
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) {
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

/** 파일명에서 연도 추출 (25년/26년 우선) - 추측 없이 명시된 값만 사용 */
function yearFromFilename(filePath) {
  const name = filePath.split(/[/\\]/).pop() || "";
  if (/26년|2026|_26\b|\(26\)/.test(name)) return 2026;
  if (/25년|2025|_25\b|\(25\)/.test(name)) return 2025;
  const m = name.match(/(\d{2})년/);
  if (m) {
    const y = parseInt(m[1], 10);
    return y < 50 ? 2000 + y : 1900 + y;
  }
  const mFull = name.match(/(\d{4})/);
  if (mFull) {
    const y = parseInt(mFull[1], 10);
    if (y >= 2020 && y <= 2030) return y;
  }
  return new Date().getFullYear();
}

function collectFiles(dir, acc = []) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) collectFiles(full, acc);
    else if (/\.xlsx?$/i.test(e.name)) acc.push(full);
  }
  return acc;
}

loadEnv();

const rawUrl = process.env.NEXT_PUBLIC_APP_URL || "";
const API_URL =
  rawUrl && !rawUrl.includes("your-app") && !rawUrl.includes("your-project")
    ? rawUrl.replace(/\/$/, "")
    : "http://localhost:3007";
const input = process.argv[2];

if (!input) {
  console.error("사용법: node scripts/bulk-upload-production-sheet.mjs <파일경로 또는 폴더경로>");
  process.exit(1);
}

const absInput = resolve(process.cwd(), input);
let files = [];
if (existsSync(absInput)) {
  if (statSync(absInput).isDirectory()) {
    files = collectFiles(absInput).sort();
    console.log(`폴더에서 ${files.length}개 Excel 파일 발견`);
  } else {
    files = [absInput];
  }
} else {
  console.error(`오류: 경로를 찾을 수 없습니다: ${absInput}`);
  process.exit(1);
}

const DATA_START_ROW = 3;

function findCol(row, names, norm = (s) => s.replace(/\s/g, "").toLowerCase()) {
  for (let i = 0; i < row.length; i++) {
    const v = norm(String(row[i] ?? ""));
    for (const n of names) {
      const nv = norm(n);
      if (v === nv || v.includes(nv) || nv.includes(v)) return i;
    }
  }
  return -1;
}

function toValidDateStr(y, m, d) {
  const lastDay = new Date(y, m, 0).getDate();
  const safeD = Math.min(Math.max(1, d), lastDay);
  return `${y}-${String(m).padStart(2, "0")}-${String(safeD).padStart(2, "0")}`;
}

/** 날짜 파싱 - 파일명에서 확정된 year를 우선 사용 (추측 최소화) */
function parseDate(val, year) {
  if (val == null) return null;
  if (typeof val === "object" && "getFullYear" in val) {
    const d = val;
    let y = d.getFullYear();
    if (y < 2000 || y > 2030) y = year;
    return toValidDateStr(y, d.getMonth() + 1, d.getDate());
  }
  if (typeof val === "number" && Number.isFinite(val) && val >= 0) {
    try {
      const parsed = XLSX.SSF?.parse_date_code?.(val);
      if (parsed?.y && parsed?.m && parsed?.d) {
        let y = parsed.y;
        if (y < 2000 || y > 2030) y = year;
        return toValidDateStr(y, parsed.m, parsed.d);
      }
      const excelEpoch = new Date(1899, 11, 30);
      const jsDate = new Date(excelEpoch.getTime() + val * 86400 * 1000);
      let y = jsDate.getFullYear();
      if (y < 2000 || y > 2030) y = year;
      return toValidDateStr(y, jsDate.getMonth() + 1, jsDate.getDate());
    } catch {
      return null;
    }
  }
  const s = String(val).trim();
  if (!s) return null;
  const m1 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m1) {
    let y = parseInt(m1[1], 10);
    if (y < 2000 || y > 2030) y = year;
    return toValidDateStr(y, parseInt(m1[2], 10), parseInt(m1[3], 10));
  }
  const mKorean = s.match(/(\d{1,2})월\s*(\d{1,2})일/);
  if (mKorean) {
    const m = parseInt(mKorean[1], 10);
    const d = parseInt(mKorean[2], 10);
    return toValidDateStr(year, m, d);
  }
  const mShort = s.match(/^(\d{2,4})[.\/-](\d{1,2})$/);
  if (mShort) {
    let y = parseInt(mShort[1], 10);
    const m = parseInt(mShort[2], 10);
    if (y < 100) y += y < 50 ? 2000 : 1900;
    return toValidDateStr(y, m, 1);
  }
  const m2 = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{1,2})$/);
  if (m2) {
    let y = parseInt(m2[1], 10);
    const m = parseInt(m2[2], 10);
    const d = parseInt(m2[3], 10);
    if (y < 100) y += y < 50 ? 2000 : 1900;
    return toValidDateStr(y, m, d);
  }
  return null;
}

function safeInt(val) {
  if (val == null) return 0;
  const n = parseInt(String(val).replace(/[,.\s]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

function toSalesChannel(val) {
  const s = String(val ?? "").toLowerCase();
  return s.includes("쿠팡") || s.includes("coupang") ? "coupang" : "general";
}

/** Rawdata 시트에서 품목코드 → 제품원가표 매핑 (재고 금액 복원용) */
function loadRawdataCostMap(wb) {
  const sheet = wb.SheetNames?.find((s) => s.replace(/\s/g, "").toLowerCase() === "rawdata")
    ? wb.Sheets[wb.SheetNames.find((s) => s.replace(/\s/g, "").toLowerCase() === "rawdata")]
    : null;
  if (!sheet) return {};
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  let headerRow = -1;
  let idxCode = -1;
  for (let r = 0; r < Math.min(15, data.length); r++) {
    const h = data[r] ?? [];
    idxCode = findCol(h, ["품목코드", "품번", "제품코드", "SKU"]);
    if (idxCode >= 0) {
      headerRow = r;
      break;
    }
  }
  if (headerRow < 0 || idxCode < 0) return {};
  const idxCost = findCol(data[headerRow] ?? [], ["제품원가표", "제품 원가표", "원가", "단가"]);
  if (idxCost < 0) return {};
  const costMap = {};
  for (let r = headerRow + 1; r < data.length; r++) {
    const row = data[r] ?? [];
    const code = String(row[idxCode] ?? "").trim();
    if (!code || code.toLowerCase() === "nan") continue;
    const digits = (code.match(/\d/g) ?? []).length;
    if (code.length < 5 || digits < code.length * 0.5) continue;
    const cost = parseFloat(String(row[idxCost] ?? "").replace(/,/g, ""));
    if (Number.isFinite(cost) && cost > 0) costMap[code] = cost;
  }
  return costMap;
}

function parseSheet(wb, sheetName, dateColNames, year) {
  const sheet = wb.SheetNames?.find((s) => s.replace(/\s/g, "") === sheetName.replace(/\s/g, ""))
    ? wb.Sheets[wb.SheetNames.find((s) => s.replace(/\s/g, "") === sheetName.replace(/\s/g, ""))]
    : null;
  if (!sheet) return { rows: [], idxCode: -1, idxQty: -1, idxDate: -1, idxSc: -1 };

  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  const headerRow = Math.min(DATA_START_ROW - 1, 2);
  const h = data[headerRow] ?? [];
  const idxCode = findCol(h, ["품목코드", "품번", "제품코드", "SKU"]);
  const idxQty = findCol(h, ["수량"]);
  const idxDate = findCol(h, dateColNames);
  const idxSc = findCol(h, ["매출구분", "판매처"]);
  return { data, headerRow, idxCode, idxQty, idxDate, idxSc };
}

async function parseFile(filePath, rawdataCostMap = {}) {
  const buf = readFileSync(filePath);
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });

  const sheetNames = wb.SheetNames ?? [];
  const has = (n) => sheetNames.some((s) => s.replace(/\s/g, "") === n.replace(/\s/g, ""));
  if (!has("입고") || !has("출고") || !has("재고")) {
    return null;
  }

  const year = yearFromFilename(filePath);
  const inbound = [];
  const outbound = [];
  const stockSnapshot = [];
  const currentProductCodes = new Set();

  const inParsed = parseSheet(wb, "입고", ["입고일자", "입고일", "일자"], year);
  if (inParsed.idxCode >= 0 && inParsed.idxQty >= 0 && inParsed.idxDate >= 0) {
    for (let r = DATA_START_ROW; r < (inParsed.data?.length ?? 0); r++) {
      const row = inParsed.data[r] ?? [];
      const code = String(row[inParsed.idxCode] ?? "").trim();
      const qty = safeInt(row[inParsed.idxQty]);
      const dateStr = parseDate(row[inParsed.idxDate], year);
      if (!code || code.toLowerCase() === "nan" || qty <= 0 || !dateStr) continue;
      inbound.push({
        product_code: code,
        quantity: qty,
        inbound_date: dateStr,
        sales_channel: inParsed.idxSc >= 0 ? toSalesChannel(row[inParsed.idxSc]) : "general",
      });
      if (r === DATA_START_ROW) {
        console.log(`    품목 ${code}: ${dateStr} 입고 (${year}년)`);
      }
    }
  }

  const outParsed = parseSheet(wb, "출고", ["출고일자", "출고일", "일자"], year);
  if (outParsed.idxCode >= 0 && outParsed.idxQty >= 0 && outParsed.idxDate >= 0) {
    for (let r = DATA_START_ROW; r < (outParsed.data?.length ?? 0); r++) {
      const row = outParsed.data[r] ?? [];
      const code = String(row[outParsed.idxCode] ?? "").trim();
      const qty = safeInt(row[outParsed.idxQty]);
      const dateStr = parseDate(row[outParsed.idxDate], year);
      if (!code || code.toLowerCase() === "nan" || qty <= 0 || !dateStr) continue;
      outbound.push({
        product_code: code,
        quantity: qty,
        outbound_date: dateStr,
        sales_channel: outParsed.idxSc >= 0 ? toSalesChannel(row[outParsed.idxSc]) : "general",
      });
      if (r === DATA_START_ROW) {
        console.log(`    품목 ${code}: ${dateStr} 출고 (${year}년)`);
      }
    }
  }

  const stockSheet = wb.SheetNames?.find((s) => s.replace(/\s/g, "") === "재고")
    ? wb.Sheets[wb.SheetNames.find((s) => s.replace(/\s/g, "") === "재고")]
    : null;
  if (stockSheet) {
    const data = XLSX.utils.sheet_to_json(stockSheet, { header: 1, defval: "" });
    let headerRow = -1;
    for (let r = 0; r < Math.min(10, data.length); r++) {
      const h = data[r] ?? [];
      if (findCol(h, ["품목코드", "품번"]) >= 0 && findCol(h, ["수량", "재고"]) >= 0) {
        headerRow = r;
        break;
      }
    }
    if (headerRow >= 0) {
      const h = data[headerRow] ?? [];
      const idxCode = findCol(h, ["품목코드", "품번", "제품코드", "SKU"]);
      const idxQty = findCol(h, ["수량", "재고", "재고수량"]);
      const idxCost = findCol(h, ["원가", "제품원가표", "단가", "재고원가"]);
      if (idxCode >= 0 && idxQty >= 0) {
        const agg = {};
        for (let r = headerRow + 1; r < data.length; r++) {
          const row = data[r] ?? [];
          const code = String(row[idxCode] ?? "").trim();
          if (!code || code.toLowerCase() === "nan") continue;
          const digits = (code.match(/\d/g) ?? []).length;
          if (code.length < 5 || digits < code.length * 0.5) continue;
          const qty = safeInt(row[idxQty]);
          let cost = rawdataCostMap[code] ?? (idxCost >= 0 ? parseFloat(String(row[idxCost] ?? "").replace(/,/g, "")) : 0);
          if (!Number.isFinite(cost)) cost = 0;
          if (!agg[code]) agg[code] = { qty: 0, cost: 0 };
          agg[code].qty += qty;
          agg[code].cost = cost > 0 ? cost : agg[code].cost;
        }
        const MAX_QTY = 2147483647;
        const MAX_COST = 9999999999.99;
        for (const [code, { qty, cost }] of Object.entries(agg)) {
          currentProductCodes.add(code);
          const safeQty = Math.max(0, Math.min(MAX_QTY, Math.floor(qty)));
          const safeCost = Math.max(0, Math.min(MAX_COST, Math.round((cost || 0) * 100) / 100));
          stockSnapshot.push({
            product_code: code,
            quantity: safeQty,
            unit_cost: safeCost,
          });
        }
      }
    }
  }

  return { inbound, outbound, stockSnapshot, currentProductCodes };
}

const BATCH_SIZE = 300;
const PARALLEL_FILES = 4;

async function main() {
  const allInbound = [];
  const allOutbound = [];
  const stockByCode = new Map();
  const allCurrentProductCodes = new Set();

  let rawdataCostMap = {};
  for (const fp of files) {
    const buf = readFileSync(fp);
    const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
    rawdataCostMap = loadRawdataCostMap(wb);
    if (Object.keys(rawdataCostMap).length > 0) {
      console.log(`Rawdata 원가표: ${Object.keys(rawdataCostMap).length}건 로드`);
      break;
    }
  }

  console.log(`\n[1] 병렬 파싱 (최대 ${PARALLEL_FILES}개 동시):`);
  const chunks = [];
  for (let i = 0; i < files.length; i += PARALLEL_FILES) {
    chunks.push(files.slice(i, i + PARALLEL_FILES));
  }
  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    const pct = Math.round(((ci * PARALLEL_FILES) / files.length) * 100);
    console.log(`  진행 ${pct}%: ${chunk.length}개 파일 처리 중...`);
    const results = await Promise.all(
      chunk.map(async (fp) => {
        const fileYear = yearFromFilename(fp);
        const parsed = await parseFile(fp, rawdataCostMap);
        return { fp, fileYear, parsed };
      })
    );
    for (const { fp, fileYear, parsed } of results) {
      const baseName = fp.split(/[/\\]/).pop() || fp;
      if (!parsed) {
        console.warn(`    건너뜀: ${baseName} (입고/출고/재고 시트 없음)`);
        continue;
      }
      console.log(`    ${baseName} → ${fileYear}년 (입고 ${parsed.inbound.length}건, 출고 ${parsed.outbound.length}건)`);
      allInbound.push(...parsed.inbound);
      allOutbound.push(...parsed.outbound);
      for (const s of parsed.stockSnapshot) stockByCode.set(s.product_code, s);
      parsed.currentProductCodes.forEach((c) => allCurrentProductCodes.add(c));
    }
  }
  console.log(`  진행 100%: 파싱 완료`);

  const seenIn = new Map();
  const seenOut = new Map();
  for (const r of allInbound) {
    const k = `${r.product_code}|${r.inbound_date}|${r.sales_channel}`;
    seenIn.set(k, r);
  }
  for (const r of allOutbound) {
    const k = `${r.product_code}|${r.outbound_date}|${r.sales_channel}`;
    seenOut.set(k, r);
  }
  const inbound = Array.from(seenIn.values());
  const outbound = Array.from(seenOut.values());
  const stockSnapshot = Array.from(stockByCode.values());
  const currentProductCodes = Array.from(allCurrentProductCodes);

  console.log(`\n[2] 파싱 완료 (총합)`);
  console.log(`  입고: ${inbound.length}건`);
  console.log(`  출고: ${outbound.length}건`);
  console.log(`  재고: ${stockSnapshot.length}건`);
  if (inbound[0]) console.log(`  최종 파싱된 날짜 예시(입고): ${inbound[0].inbound_date}`);
  if (outbound[0]) console.log(`  최종 파싱된 날짜 예시(출고): ${outbound[0].outbound_date}`);

  if (inbound.length === 0 && outbound.length === 0 && stockSnapshot.length === 0) {
    console.error("업로드할 데이터가 없습니다.");
    process.exit(1);
  }

  console.log(`\n[3] API로 Bulk 업로드 시도... (${API_URL})`);
  console.log(`  ⚠ 운영 정책: 웹 UI에서만 DB 반영 가능. 스크립트 호출은 403 차단됨.`);
  console.log(`  → 대시보드에서 Excel 업로드 → 검증 → DB 반영 클릭`);
  const res = await fetch(`${API_URL}/api/production-sheet-upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      inbound,
      outbound,
      stockSnapshot,
      currentProductCodes,
    }),
  });

  const json = await res.json();
  if (!res.ok) {
    if (res.status === 403) {
      console.error("업로드 차단:", json.error || "웹 UI에서만 DB 반영 가능");
      console.error("→ 대시보드에서 Excel 업로드 → 검증 → DB 반영 클릭");
    } else {
      console.error("업로드 실패:", json.error || res.statusText);
    }
    process.exit(1);
  }

  console.log("\n[4] 완료!");
  console.log(`  입고: ${json.inbound?.upserted ?? 0}건`);
  console.log(`  출고: ${json.outbound?.upserted ?? 0}건`);
  console.log(`  재고 스냅샷: ${json.stockSnapshot ?? 0}건`);

  console.log("\n[5] 검증 중...");
  try {
    const diagRes = await fetch(`${API_URL}/api/inventory-diag`);
    const diag = await diagRes.json();
    if (diag.ok) {
      const t = diag.tables;
      console.log(`  Supabase 프로젝트: ${diag.supabaseProject ?? "?"}`);
      console.log(`  DB 실제 row 수: 입고 ${t.inventory_inbound} / 출고 ${t.inventory_outbound} / 재고스냅샷 ${t.inventory_stock_snapshot} / 재고금액 ${(diag.totalValue ?? 0).toLocaleString()}원`);
      if (t.inventory_inbound === 0 && t.inventory_outbound === 0 && t.inventory_stock_snapshot === 0) {
        console.warn("\n  ⚠ 경고: DB에 데이터가 없습니다. Supabase 프로젝트 불일치 가능성.");
        console.warn("  → localhost에서 보시나요? 배포 URL(vercel.app) 사용 시 Vercel env의 Supabase가 다를 수 있습니다.");
        console.warn("  → http://localhost:3000 으로 접속 후 새로고침해 보세요.");
      }
    } else {
      console.warn("  검증 API 실패:", diag.error);
    }
  } catch (e) {
    console.warn("  검증 API 호출 실패:", e.message);
  }
  console.log(`\n대시보드(${API_URL})에서 1년치 차트를 확인하세요.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
