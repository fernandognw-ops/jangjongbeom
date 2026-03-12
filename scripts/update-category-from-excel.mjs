#!/usr/bin/env node
/**
 * 26년 0311_생산수불현황 엑셀 '재고' 시트 → inventory_stock_snapshot.category 업데이트
 *
 * - 품목코드 → product_code 매칭
 * - 품목구분 → category 입력
 * - TRUNCATE 없음, Upsert 방식 (기존 창고 분류 coupang/general, 복합 PK 유지)
 * - category 컬럼만 정확히 매핑하여 업데이트
 *
 * 사용법:
 *   node scripts/update-category-from-excel.mjs "경로/26년 0311_생산수불현황.xlsx"
 */

import { readFileSync, existsSync } from "fs";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";
import XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

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

function findCol(row, names, norm = (s) => s.replace(/\s/g, "").toLowerCase()) {
  for (let i = 0; i < row.length; i++) {
    const v = norm(String(row[i] ?? ""));
    if (!v) continue;
    for (const n of names) {
      const nv = norm(n);
      if (v === nv || v.includes(nv) || (nv && nv.includes(v))) return i;
    }
  }
  return -1;
}

function findHeaderRow(data, requiredGroups) {
  for (let r = 0; r < Math.min(20, data.length); r++) {
    const h = data[r] ?? [];
    let ok = true;
    for (const group of requiredGroups) {
      if (findCol(h, group) < 0) {
        ok = false;
        break;
      }
    }
    if (ok) return r;
  }
  return -1;
}

function normalizeProductCode(v) {
  if (v == null) return "";
  const s = String(v).trim();
  const num = parseFloat(s);
  if (Number.isFinite(num) && (num >= 1e10 || num <= -1e10)) return String(Math.round(num));
  if (Number.isFinite(num) && !Number.isInteger(num)) return String(Math.round(num));
  return s;
}

/**
 * 시트에서 품목코드 → 품목구분 매핑 추출
 */
function extractFromSheet(wb, sheetName, map) {
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return;
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  const headerRow = findHeaderRow(data, [["품목코드", "품번", "제품코드", "SKU"]]);
  if (headerRow < 0) return;

  const h = data[headerRow] ?? [];
  const idxCode = findCol(h, ["품목코드", "품번", "제품코드", "SKU"]);
  let idxCategory = findCol(h, ["품목구분", "카테고리"]);
  if (idxCategory < 0) {
    idxCategory = findCol(h, ["품목"]);
    if (idxCategory === idxCode) idxCategory = -1;
  }
  if (idxCode < 0 || idxCategory < 0) return;

  for (let r = headerRow + 1; r < data.length; r++) {
    const row = data[r] ?? [];
    let code = String(row[idxCode] ?? "").trim();
    code = normalizeProductCode(code) || code;
    const category = String(row[idxCategory] ?? "").trim();

    if (!code || code.toLowerCase() === "nan") continue;
    const digits = (code.match(/\d/g) ?? []).length;
    if (code.length < 5 || digits < code.length * 0.5) continue;

    if (category && category !== "전체") {
      map.set(code, category);
    }
  }
}

/**
 * 엑셀 '재고' 시트 → 'rawdata' 시트 순으로 품목코드 → 품목구분 매핑 추출
 */
function extractCategoryMap(filePath) {
  const buf = readFileSync(filePath);
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const map = new Map();

  const sheetNames = wb.SheetNames ?? [];
  const reorder = sheetNames.find((s) => s.replace(/\s/g, "") === "재고")
    ? ["재고", "rawdata"]
    : ["rawdata"];

  for (const name of reorder) {
    const sheetName = sheetNames.find((s) => s.replace(/\s/g, "") === name.replace(/\s/g, ""));
    if (sheetName) extractFromSheet(wb, sheetName, map);
  }

  if (map.size === 0 && !sheetNames.find((s) => s.replace(/\s/g, "") === "재고")) {
    throw new Error("엑셀에 '재고' 또는 'rawdata' 시트가 없습니다.");
  }
  return map;
}

async function main() {
  loadEnv();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error("오류: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY가 .env.local에 필요합니다.");
    process.exit(1);
  }

  const input = process.argv[2];
  if (!input) {
    console.error("사용법: node scripts/update-category-from-excel.mjs <엑셀파일경로>");
    console.error("예: node scripts/update-category-from-excel.mjs \"26년 0311_생산수불현황.xlsx\"");
    process.exit(1);
  }

  const absPath = resolve(process.cwd(), input);
  if (!existsSync(absPath)) {
    console.error(`오류: 파일을 찾을 수 없습니다: ${absPath}`);
    process.exit(1);
  }

  console.log(`[1] 엑셀 파싱: ${absPath}`);
  const categoryMap = extractCategoryMap(absPath);
  console.log(`    품목코드 → 품목구분 매핑: ${categoryMap.size}건`);

  if (categoryMap.size === 0) {
    console.error("업데이트할 품목이 없습니다.");
    console.error("  - 재고/rawdata 시트에 품목코드, 품목구분(또는 품목) 컬럼이 있는지 확인하세요.");
    console.error("  - 품목구분에 마스크/캡슐세제/생활용품 등이 입력되어 있어야 합니다. (전체/비어있으면 제외)");
    process.exit(1);
  }

  const supabase = createClient(url, key);

  const codes = Array.from(categoryMap.keys());
  const BATCH = 50;
  let updatedCount = 0;
  let skippedCount = 0;

  console.log(`\n[2] inventory_stock_snapshot.category 업데이트 (Upsert, TRUNCATE 없음)`);
  console.log(`    창고 분류(coupang/general) 및 복합 PK(product_code+dest_warehouse) 유지`);

  for (let i = 0; i < codes.length; i += BATCH) {
    const batch = codes.slice(i, i + BATCH);

    for (const productCode of batch) {
      const category = categoryMap.get(productCode);
      if (!category) continue;

      // product_code 기준으로 category만 업데이트 (동일 품목의 모든 창고 행에 동일 category 적용)
      const { data, error } = await supabase
        .from("inventory_stock_snapshot")
        .update({ category })
        .eq("product_code", productCode)
        .select("product_code");

      if (error) {
        console.warn(`    경고: ${productCode} - ${error.message}`);
        skippedCount++;
        continue;
      }

      const count = (data ?? []).length;
      if (count > 0) {
        updatedCount += count;
      } else {
        skippedCount++;
      }
    }

    const pct = Math.min(100, Math.round(((i + batch.length) / codes.length) * 100));
    process.stdout.write(`\r    진행 ${pct}% (${updatedCount}행 업데이트)`);
  }

  console.log(`\n\n[3] inventory_products.category, group_name 동기화`);
  let productsUpdated = 0;
  for (const [productCode, category] of categoryMap) {
    if (!category || category === "기타") continue;
    const { data, error } = await supabase
      .from("inventory_products")
      .update({ category, group_name: category })
      .eq("product_code", productCode)
      .select("product_code");
    if (!error && (data ?? []).length > 0) productsUpdated++;
  }
  console.log(`    inventory_products: ${productsUpdated}건 업데이트`);

  console.log(`\n[4] 완료`);
  console.log(`    inventory_stock_snapshot: ${updatedCount}건`);
  if (skippedCount > 0) {
    console.log(`    스킵(DB에 없음): ${skippedCount}건`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
