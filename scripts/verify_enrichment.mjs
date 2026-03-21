#!/usr/bin/env node
/**
 * enrichment 보정 후 검증
 * - 샘플 row 확인 (inbound, outbound, stock_snapshot)
 * - /api/inventory/quick 응답 확인
 */
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

function sampleRow(r, fields) {
  const o = {};
  for (const f of fields) o[f] = r[f];
  return o;
}

async function main() {
  console.log("\n=== enrichment 검증 ===\n");

  const { data: inSample } = await supabase.from("inventory_inbound").select("product_code,product_name,category,pack_size,unit_price,total_price,quantity").limit(2);
  console.log("inventory_inbound 샘플:");
  for (const r of inSample ?? []) {
    console.log(" ", JSON.stringify(sampleRow(r, ["product_code", "product_name", "category", "pack_size", "unit_price", "total_price", "quantity"])));
  }

  const { data: outSample } = await supabase.from("inventory_outbound").select("product_code,product_name,category,pack_size,unit_price,total_price,quantity").limit(2);
  console.log("\ninventory_outbound 샘플:");
  for (const r of outSample ?? []) {
    console.log(" ", JSON.stringify(sampleRow(r, ["product_code", "product_name", "category", "pack_size", "unit_price", "total_price", "quantity"])));
  }

  const { data: stockSample } = await supabase.from("inventory_stock_snapshot").select("product_code,product_name,category,pack_size,unit_cost,total_price,quantity").limit(2);
  console.log("\ninventory_stock_snapshot 샘플:");
  for (const r of stockSample ?? []) {
    console.log(" ", JSON.stringify(sampleRow(r, ["product_code", "product_name", "category", "pack_size", "unit_cost", "total_price", "quantity"])));
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://jangjongbeom.vercel.app";
  console.log("\n/api/inventory/quick 호출:", appUrl);
  try {
    const res = await fetch(`${appUrl}/api/inventory/quick`);
    const json = await res.json();
    console.log("  totalValue:", json.totalValue);
    console.log("  productCount:", json.productCount);
    console.log("  error:", json.error ?? "(없음)");
  } catch (e) {
    console.log("  오류:", e.message);
  }
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
