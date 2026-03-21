#!/usr/bin/env node
/**
 * 적재 후 DB 검증 (Supabase 직접 조회)
 * 실행: node scripts/verify_db_after_load.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const envPath = join(root, ".env.local");
if (existsSync(envPath)) {
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq > 0 && !process.env[t.slice(0, eq).trim()]) {
      const k = t.slice(0, eq).trim();
      const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      process.env[k] = v;
    }
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;

if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY 필요");
  process.exit(1);
}

const supabase = createClient(url, key);

async function main() {
  console.log("\n=== 적재 후 DB 검증 ===\n");

  // 1) 재고 건수
  const { count: stockCount } = await supabase
    .from("inventory_stock_snapshot")
    .select("*", { count: "exact", head: true });
  console.log("1) 재고 건수:", stockCount, "(기대: 414 근처)");

  // 2) 채널 분포
  const { data: channelData } = await supabase
    .from("inventory_stock_snapshot")
    .select("dest_warehouse");
  const dist = {};
  for (const r of channelData || []) {
    const wh = r.dest_warehouse || "일반";
    dist[wh] = (dist[wh] || 0) + 1;
  }
  console.log("2) 채널 분포:", dist, "(기대: 일반 260, 쿠팡 154)");

  // 3) 총 금액
  const { data: sumData } = await supabase
    .from("inventory_stock_snapshot")
    .select("total_price");
  const total = (sumData || []).reduce((a, r) => a + (parseFloat(r.total_price) || 0), 0);
  console.log("3) 총 금액:", Math.round(total), "(기대: 789224584)");

  // 4) 중복 검증
  const { data: allStock } = await supabase
    .from("inventory_stock_snapshot")
    .select("product_code,dest_warehouse,snapshot_date");
  const seen = {};
  let dups = 0;
  for (const r of allStock || []) {
    const k = `${r.product_code}|${r.dest_warehouse}|${r.snapshot_date}`;
    if (seen[k]) dups++;
    seen[k] = (seen[k] || 0) + 1;
  }
  const dupKeys = Object.entries(seen).filter(([, v]) => v > 1);
  console.log("4) 중복 검증:", dupKeys.length === 0 ? "없음 (정상)" : `중복 ${dupKeys.length}건`);

  console.log("\n=== 완료 ===\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
