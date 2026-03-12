#!/usr/bin/env node
/**
 * 엑셀 시트 구조 확인 (품목코드, 품목구분 컬럼 찾기)
 * 사용법: node scripts/debug-excel-category.mjs "경로/파일.xlsx"
 */
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import XLSX from "xlsx";

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
  for (let r = 0; r < Math.min(15, data.length); r++) {
    const h = data[r] ?? [];
    let ok = true;
    for (const group of requiredGroups) {
      if (findCol(h, group) < 0) { ok = false; break; }
    }
    if (ok) return r;
  }
  return -1;
}

const input = process.argv[2];
if (!input) {
  console.error("사용법: node scripts/debug-excel-category.mjs \"경로/파일.xlsx\"");
  process.exit(1);
}
const absPath = resolve(process.cwd(), input);
if (!existsSync(absPath)) {
  console.error("파일 없음:", absPath);
  process.exit(1);
}

const wb = XLSX.read(readFileSync(absPath), { type: "buffer", cellDates: true });
console.log("시트 목록:", wb.SheetNames);

for (const sheetName of ["재고", "rawdata"]) {
  const sn = wb.SheetNames.find((s) => s.replace(/\s/g, "") === sheetName);
  if (!sn) continue;

  const data = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: "" });
  const hr = findHeaderRow(data, [["품목코드", "품번", "제품코드", "SKU"]]);
  console.log(`\n=== ${sn} (${data.length}행, 헤더행: ${hr >= 0 ? hr + 1 : "없음"}) ===`);

  if (hr >= 0) {
    const h = data[hr] ?? [];
    const idxCode = findCol(h, ["품목코드", "품번", "제품코드", "SKU"]);
    let idxCat = findCol(h, ["품목구분", "카테고리"]);
    if (idxCat < 0) { idxCat = findCol(h, ["품목"]); if (idxCat === idxCode) idxCat = -1; }
    console.log("전체 헤더:", h.slice(0, 15));
    console.log("품목코드:", idxCode >= 0 ? `컬럼 ${idxCode} "${h[idxCode]}"` : "없음");
    console.log("품목구분:", idxCat >= 0 ? `컬럼 ${idxCat} "${h[idxCat]}"` : "없음");
    let withCat = 0;
    for (let r = hr + 1; r < Math.min(hr + 6, data.length); r++) {
      const row = data[r] ?? [];
      const code = String(row[idxCode] ?? "").trim();
      const cat = String(row[idxCat] ?? "").trim();
      console.log(`  샘플 행${r + 1}: code="${code}", category="${cat}"`);
    }
    for (let r = hr + 1; r < data.length; r++) {
      const cat = String((data[r] ?? [])[idxCat] ?? "").trim();
      if (cat && cat !== "전체") withCat++;
    }
    console.log(`  품목구분 채워진 행 (전체 제외): ${withCat}건`);
  }
}
