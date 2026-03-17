#!/usr/bin/env node
/**
 * 엑셀 수불 자료 집계 검증
 * 사용: node scripts/verify_excel_totals.mjs "경로/0317_생산수불현황.xlsx"
 *
 * 실제값과 웹 대시보드 비교용
 */
import { readFileSync } from "fs";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const filePath = process.argv[2];
if (!filePath) {
  console.error("사용법: node scripts/verify_excel_totals.mjs <엑셀파일경로>");
  process.exit(1);
}

const buf = readFileSync(filePath);
const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
const sheetNames = wb.SheetNames || [];
const stockSheet = sheetNames.find((s) => s.replace(/\s/g, "") === "재고");

if (!stockSheet) {
  console.error("재고 시트를 찾을 수 없습니다.");
  process.exit(1);
}

const data = XLSX.utils.sheet_to_json(wb.Sheets[stockSheet], { header: 1, defval: "" });
const findCol = (h, names, opts = {}) => {
  const exclude = opts.exclude || [];
  for (let i = 0; i < h.length; i++) {
    const v = String(h[i] ?? "").trim();
    for (const n of names) {
      if (v.includes(n) || n.includes(v)) {
        if (exclude.some((e) => v.includes(e))) continue;
        return i;
      }
    }
  }
  return -1;
};

let headerRow = -1;
for (let r = 0; r < Math.min(5, data.length); r++) {
  const row = data[r] || [];
  const hasCode = row.some((c) => /품목코드|품번|제품코드/.test(String(c ?? "")));
  const hasQty = row.some((c) => /수량|재고수량/.test(String(c ?? "")) && !/입수량/.test(String(c ?? "")));
  if (hasCode && hasQty) {
    headerRow = r;
    break;
  }
}

if (headerRow < 0) {
  console.error("재고 시트 헤더를 찾을 수 없습니다.");
  process.exit(1);
}

const h = data[headerRow] || [];
const idxCode = findCol(h, ["품목코드", "품번", "제품코드", "SKU"]);
let idxQty = findCol(h, ["수량", "재고수량"], { exclude: ["입수량", "재고금액", "재고원가"] });
if (idxQty < 0) idxQty = findCol(h, ["재고"], { exclude: ["재고금액", "재고원가"] });
let idxAmount = findCol(h, ["재고 금액", "재고금액"], { exclude: ["재고원가"] });
if (idxAmount < 0) idxAmount = findCol(h, ["재고원가"]);
const idxCost = findCol(h, ["단가", "원가", "제품원가표", "재고원가"]);
const idxWh = findCol(h, ["창고명", "창고", "보관장소", "입고처"]);
const idxPack = findCol(h, ["입수량", "입수"]);

if (idxCode < 0 || idxQty < 0) {
  console.error("품목코드, 수량 열이 필요합니다.");
  process.exit(1);
}

const agg = {};
const dataStart = headerRow + 2;
for (let r = dataStart; r < data.length; r++) {
  const row = data[r] || [];
  const code = String(row[idxCode] ?? "").trim();
  if (!code || code.toLowerCase() === "nan") continue;
  const digits = (code.match(/\d/g) || []).length;
  if (code.length < 5 || digits < code.length * 0.5) continue;

  const qty = parseInt(row[idxQty], 10) || 0;
  let cost = parseFloat(row[idxCost]) || 0;
  const amount = parseFloat(row[idxAmount]) || 0;
  if (cost <= 0 && amount > 0 && qty > 0) cost = amount / qty;
  const totalPrice = amount > 0 ? amount : qty * cost;
  const whRaw = idxWh >= 0 ? String(row[idxWh] ?? "").trim() : "";
  const wh = whRaw ? normalizeWh(whRaw) : "제이에스";
  const pack = idxPack >= 0 ? (parseInt(row[idxPack], 10) || 0) : 0;

  const key = `${code}|${wh}`;
  if (!agg[key]) agg[key] = { qty: 0, cost: 0, totalPrice: 0, pack: 0 };
  agg[key].qty += qty;
  agg[key].cost = cost > 0 ? cost : agg[key].cost;
  agg[key].totalPrice += totalPrice;
  if (pack > 0 && agg[key].pack <= 0) agg[key].pack = pack;
}

function normalizeWh(s) {
  const t = s.replace(/\s/g, "").toLowerCase();
  if (/테이칼튼/.test(s)) return "테이칼튼";
  if (/제이에스/.test(s)) return "제이에스";
  return "제이에스";
}

let totalValue = 0;
let totalQuantity = 0;
let totalSku = 0;
const byCode = new Map();

for (const [, v] of Object.entries(agg)) {
  const pack = v.pack > 0 ? v.pack : 1;
  totalValue += v.totalPrice;
  totalQuantity += v.qty;
  totalSku += Math.floor(v.qty / pack);
}

const codes = new Set(Object.keys(agg).map((k) => k.split("|")[0]));

console.log("=== 엑셀 수불 자료 집계 (재고 시트) ===");
console.log("파일:", filePath);
console.log("품목 수:", codes.size, "건");
console.log("총 재고 금액:", Math.round(totalValue).toLocaleString(), "원");
console.log("총 재고 수량 (EA):", totalQuantity.toLocaleString(), "EA");
console.log("SKU (박스):", totalSku.toLocaleString(), "박스");
console.log("");
console.log("※ 웹 대시보드와 비교 시 위 값과 일치해야 합니다.");
