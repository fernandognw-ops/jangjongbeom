#!/usr/bin/env node
/**
 * inventory_outbound 2025-07 범위 삭제 도구
 *
 * 업로드 파서/매핑 수정 후 재업로드 시,
 * source_row_key가 sales_channel을 포함하므로
 * 기존 오분류(general) 행이 남아 중복/누적될 수 있습니다.
 *
 * 사용:
 *   node scripts/delete_outbound_2025_07.mjs stats
 *   node scripts/delete_outbound_2025_07.mjs delete
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import { join, resolve } from "path";

const FROM = "2025-07-01";
const TO = "2025-08-01";
const PAGE = 2000;

const root = resolve(process.cwd());
const envPath = join(root, ".env.local");

function loadEnvLocal() {
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}

function num(v) {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

async function fetchAllRange(supabase) {
  const rows = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("inventory_outbound")
      .select("id,outbound_date,product_code,quantity,sales_channel,total_price,dest_warehouse")
      .gte("outbound_date", FROM)
      .lt("outbound_date", TO)
      .order("outbound_date", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE) break;
    offset += PAGE;
  }
  return rows;
}

function aggregate(rows) {
  let sumQty = 0;
  let sumAmount = 0;
  const bySales = {};
  for (const r of rows) {
    const q = num(r.quantity);
    const a = num(r.total_price);
    sumQty += q;
    sumAmount += a;
    const sc = String(r.sales_channel ?? "").trim() || "NULL";
    bySales[sc] = (bySales[sc] ?? 0) + a;
  }
  return { rowCount: rows.length, sumQty, sumAmount, bySales };
}

async function deleteByIds(supabase, ids) {
  const BATCH = 500;
  let deleted = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const { error } = await supabase.from("inventory_outbound").delete().in("id", batch);
    if (error) throw new Error(error.message);
    deleted += batch.length;
    process.stdout.write(`\r  deleting... ${deleted}/${ids.length}`);
  }
  if (ids.length > 0) process.stdout.write("\n");
  return deleted;
}

async function main() {
  loadEnvLocal();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 미설정");

  const mode = String(process.argv[2] ?? "stats").toLowerCase();
  const supabase = createClient(url, key);

  const rows = await fetchAllRange(supabase);
  const agg = aggregate(rows);

  console.log(`=== inventory_outbound ${FROM} <= outbound_date < ${TO} 사전 점검 ===`);
  console.log(`row_count: ${agg.rowCount}`);
  console.log(`SUM(quantity): ${agg.sumQty}`);
  console.log(`SUM(total_price): ${agg.sumAmount}`);
  console.log("sales_channel별 SUM(total_price):");
  for (const [k, v] of Object.entries(agg.bySales).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${k}: ${v}`);
  }

  if (mode === "stats") return;

  if (mode !== "delete") throw new Error(`알 수 없는 모드: ${mode}`);

  const ids = rows.map((r) => r.id).filter(Boolean);
  if (ids.length === 0) {
    console.log("삭제할 행이 없습니다.");
    return;
  }

  console.log(`\n=== 삭제 진행: ${ids.length} rows ===`);
  const deleted = await deleteByIds(supabase, ids);
  console.log(`삭제 완료: ${deleted} rows`);

  const afterRows = await fetchAllRange(supabase);
  const afterAgg = aggregate(afterRows);
  console.log(`\n=== 삭제 후 점검 ===`);
  console.log(`row_count: ${afterAgg.rowCount}`);
  console.log(`sales_channel별 SUM(total_price):`);
  for (const [k, v] of Object.entries(afterAgg.bySales).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${k}: ${v}`);
  }
}

main().catch((e) => {
  console.error("[delete_outbound_2025_07] error:", e?.message ?? e);
  process.exit(1);
});

