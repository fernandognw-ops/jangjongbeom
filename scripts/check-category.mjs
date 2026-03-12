#!/usr/bin/env node
/** DB + Snapshot API 카테고리 상태 확인 */
import { readFileSync, existsSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const envPath = join(root, ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim();
    if (t && !t.startsWith("#") && t.includes("=")) {
      const [k, ...v] = t.split("=");
      if (k && !process.env[k.trim()]) process.env[k.trim()] = v.join("=").trim().replace(/^["']|["']$/g, "");
    }
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL, KEY 필요");
  process.exit(1);
}

const supabase = createClient(url, key);
const { data } = await supabase.from("inventory_stock_snapshot").select("product_code,category").limit(500);
const rows = data ?? [];
const byCat = {};
rows.forEach((r) => {
  const c = String(r.category ?? "").trim() || "(빈값)";
  byCat[c] = (byCat[c] ?? 0) + 1;
});
console.log("\n[DB inventory_stock_snapshot] category 분포:");
console.log(JSON.stringify(byCat, null, 2));
console.log("\n샘플 5건:", rows.slice(0, 5).map((r) => ({ code: r.product_code, cat: r.category })));
