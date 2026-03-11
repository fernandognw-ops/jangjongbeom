#!/usr/bin/env node
/** Supabase 테이블/컬럼 및 데이터 확인 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

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

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY 필요");
  process.exit(1);
}

const supabase = createClient(url, key);

async function main() {
  console.log("=== 테이블/컬럼 및 데이터 확인 ===\n");

  const tables = [
    "inventory_inbound",
    "inventory_outbound",
    "inventory_current_products",
    "inventory_stock_snapshot",
    "inventory_products",
  ];

  for (const table of tables) {
    const { data, error } = await supabase.from(table).select("*").limit(3);
    console.log(`[${table}]`);
    if (error) {
      console.log("  오류:", error.message);
      continue;
    }
    const { count } = await supabase.from(table).select("*", { count: "exact", head: true });
    console.log("  row 수:", count ?? data?.length ?? 0);
    if (data && data.length > 0) {
      console.log("  컬럼:", Object.keys(data[0]).join(", "));
      console.log("  샘플:", JSON.stringify(data[0], null, 2).slice(0, 300) + "...");
    }
    console.log("");
  }

  const { data: snapAll } = await supabase.from("inventory_stock_snapshot").select("quantity");
  const nonZero = (snapAll ?? []).filter((r) => (r.quantity ?? 0) > 0).length;
  console.log("[inventory_stock_snapshot] quantity > 0 인 row:", nonZero, "/", snapAll?.length ?? 0);
}

main().catch(console.error);
