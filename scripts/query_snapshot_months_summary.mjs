/**
 * 스냅샷 월별 마지막 일·카테고리 합 (category-trend 규칙과 동일하게 검증)
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env.local");

function loadEnvLocal() {
  if (!existsSync(envPath)) return {};
  const raw = readFileSync(envPath, "utf-8");
  const out = {};
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    out[k] = v;
  }
  return out;
}

const env = { ...process.env, ...loadEnvLocal() };
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error("Need .env.local Supabase keys");
  process.exit(1);
}

const supabase = createClient(url, key);
const PAGE = 2000;
const dateFrom = "2025-02-01";

const CATEGORY_ORDER = ["마스크", "캡슐세제", "섬유유연제", "액상세제", "생활용품"];

function normCat(cat) {
  const s = String(cat ?? "").trim();
  if (!s || s === "기타") return null;
  if (s === "캡슐세제 사은품" || (s.includes("캡슐세제") && s.includes("사은품"))) return "캡슐세제";
  return s;
}

async function fetchAll() {
  const rows = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("inventory_stock_snapshot")
      .select("product_code,category,snapshot_date,quantity,unit_cost,total_price")
      .gte("snapshot_date", dateFrom)
      .order("snapshot_date", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE) break;
    offset += PAGE;
  }
  return rows;
}

function lineVal(r) {
  const qty = Number(r.quantity ?? 0);
  const tp = Number(r.total_price ?? 0);
  if (tp > 0) return tp;
  const c = Number(r.unit_cost ?? 0);
  return qty * c;
}

async function main() {
  const snapRows = await fetchAll();
  const maxDateByMonth = new Map();
  for (const r of snapRows) {
    const d = String(r.snapshot_date ?? "").slice(0, 10);
    if (!d) continue;
    const mk = d.slice(0, 7);
    const ex = maxDateByMonth.get(mk);
    if (!ex || d > ex) maxDateByMonth.set(mk, d);
  }
  console.log("snapshot rows loaded:", snapRows.length);
  console.log("months with at least one snapshot day:", maxDateByMonth.size);
  console.log("last snapshot per month (sample):");
  for (const [mk, d] of [...maxDateByMonth.entries()].sort()) {
    console.log(" ", mk, "->", d);
  }

  const totals = {};
  for (const mk of maxDateByMonth.keys()) {
    const lastD = maxDateByMonth.get(mk);
    const byCat = {};
    for (const c of CATEGORY_ORDER) byCat[c] = 0;
    for (const row of snapRows) {
      if (String(row.snapshot_date ?? "").slice(0, 10) !== lastD) continue;
      let cat = normCat(row.category);
      if (!cat || !CATEGORY_ORDER.includes(cat)) continue;
      byCat[cat] += lineVal(row);
    }
    totals[mk] = { date: lastD, byCat, sum: CATEGORY_ORDER.reduce((a, c) => a + byCat[c], 0) };
  }
  console.log("\nDB monthly totals (5 cats, same filter as API):");
  for (const mk of Object.keys(totals).sort()) {
    const t = totals[mk];
    console.log(mk, "last", t.date, "sum", Math.round(t.sum), "cats", t.byCat);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
