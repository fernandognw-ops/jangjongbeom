/**
 * verify_outbound_march_2026.sql §1, §3 결과를 Supabase에서 집계 (로컬 .env.local)
 * 사용: node scripts/query_outbound_march_verify.mjs
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
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
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
  console.error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 가 .env.local에 필요합니다.");
  process.exit(1);
}

const supabase = createClient(url, key);

const FROM = "2026-03-01";
const TO = "2026-04-01";
const PAGE = 2000;

async function fetchAllMarch() {
  const rows = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("inventory_outbound")
      .select("product_code,quantity,total_price,unit_price,outbound_date,sales_channel")
      .gte("outbound_date", FROM)
      .lt("outbound_date", TO)
      .order("outbound_date", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE) break;
    offset += PAGE;
  }
  return rows;
}

function key3(r) {
  const d = String(r.outbound_date ?? "").slice(0, 10);
  return `${r.product_code}|${d}|${String(r.sales_channel ?? "").trim()}`;
}

async function main() {
  console.log("조회: inventory_outbound", FROM, "<= outbound_date <", TO);
  const rows = await fetchAllMarch();

  let sumQty = 0;
  let sumTp = 0;
  let sumQtyUp = 0;
  for (const r of rows) {
    const q = Number(r.quantity ?? 0);
    const tp = Number(r.total_price ?? 0);
    const up = Number(r.unit_price ?? 0);
    sumQty += q;
    sumTp += tp;
    sumQtyUp += q * up;
  }

  console.log("\n=== §1 (COUNT, SUM) ===");
  console.log("row_count:", rows.length);
  console.log("SUM(quantity):", sumQty);
  console.log("SUM(COALESCE(total_price,0)):", sumTp);
  console.log("SUM(quantity * unit_price) [stored]:", sumQtyUp);

  const byKey = new Map();
  for (const r of rows) {
    const k = key3(r);
    byKey.set(k, (byKey.get(k) ?? 0) + 1);
  }
  const dupKeys = [...byKey.entries()].filter(([, n]) => n > 1);
  console.log("\n=== §3 중복 (product_code + date + sales_channel, n>1) ===");
  console.log("중복 그룹 수:", dupKeys.length);
  dupKeys.sort((a, b) => b[1] - a[1]);
  for (const [k, n] of dupKeys.slice(0, 30)) {
    console.log(" ", n, k);
  }
  if (dupKeys.length > 30) console.log(" ... 외", dupKeys.length - 30, "그룹");

  const a = 601_962_003;
  const b = 621_479_062.55;
  console.log("\n=== SUM(total_price) 기준 비교 ===");
  console.log("601,962,003 과 차이:", sumTp - a);
  console.log("621,479,062.55 과 차이:", sumTp - b);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
