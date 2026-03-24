#!/usr/bin/env node
/**
 * 2025-03 inventory_outbound 백업/검증/삭제/재검증 도구
 *
 * 사용:
 *   node scripts/recover_outbound_2025_03.mjs stats
 *   node scripts/recover_outbound_2025_03.mjs backup
 *   node scripts/recover_outbound_2025_03.mjs delete
 *   node scripts/recover_outbound_2025_03.mjs verify
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const envPath = join(root, ".env.local");

const FROM = "2025-03-01";
const TO = "2025-04-01";
const PAGE = 2000;
const OUTDIR = join(root, "scripts", "backups");

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

async function fetchAllMarch(supabase) {
  const rows = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("inventory_outbound")
      .select("id,product_code,product_name,category,pack_size,quantity,outbound_date,sales_channel,dest_warehouse,unit_price,total_price")
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

function num(v) {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function aggregate(rows) {
  let qty = 0;
  let amount = 0;
  const bySales = {};
  const byDest = {};
  for (const r of rows) {
    const q = num(r.quantity);
    const a = num(r.total_price);
    qty += q;
    amount += a;
    const sc = String(r.sales_channel ?? "NULL").trim() || "NULL";
    const dw = String(r.dest_warehouse ?? "NULL").trim() || "NULL";
    bySales[sc] = (bySales[sc] ?? 0) + a;
    byDest[dw] = (byDest[dw] ?? 0) + a;
  }
  return { rowCount: rows.length, sumQty: qty, sumAmount: amount, bySales, byDest };
}

function printAgg(title, agg) {
  console.log(`\n=== ${title} ===`);
  console.log(`기간: ${FROM} <= outbound_date < ${TO}`);
  console.log(`row_count: ${agg.rowCount}`);
  console.log(`SUM(quantity): ${agg.sumQty}`);
  console.log(`SUM(total_price): ${agg.sumAmount}`);
  console.log("\n[sales_channel별 SUM(total_price)]");
  for (const [k, v] of Object.entries(agg.bySales).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${k}: ${v}`);
  }
  console.log("\n[dest_warehouse별 SUM(total_price)]");
  for (const [k, v] of Object.entries(agg.byDest).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`);
  }
}

async function deleteByIds(supabase, ids) {
  const BATCH = 500;
  let deleted = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const { error } = await supabase.from("inventory_outbound").delete().in("id", batch);
    if (error) throw new Error(error.message);
    deleted += batch.length;
  }
  return deleted;
}

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 미설정");
  }
  const mode = (process.argv[2] ?? "stats").toLowerCase();
  const supabase = createClient(url, key);

  const rows = await fetchAllMarch(supabase);
  const agg = aggregate(rows);

  if (mode === "stats" || mode === "verify") {
    printAgg(mode === "stats" ? "사전 점검" : "사후 검증", agg);
    return;
  }

  if (mode === "backup") {
    if (!existsSync(OUTDIR)) mkdirSync(OUTDIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = join(OUTDIR, `inventory_outbound_2025-03_backup_${stamp}.json`);
    writeFileSync(
      file,
      JSON.stringify(
        {
          metadata: {
            from: FROM,
            to: TO,
            createdAt: new Date().toISOString(),
            rowCount: agg.rowCount,
            sumQty: agg.sumQty,
            sumAmount: agg.sumAmount,
            bySales: agg.bySales,
            byDest: agg.byDest,
          },
          rows,
        },
        null,
        2
      ),
      "utf-8"
    );
    printAgg("백업 스냅샷", agg);
    console.log(`\n백업 파일: ${file}`);
    return;
  }

  if (mode === "delete") {
    const ids = rows.map((r) => r.id).filter(Boolean);
    printAgg("삭제 전 점검", agg);
    const deleted = await deleteByIds(supabase, ids);
    const afterRows = await fetchAllMarch(supabase);
    const afterAgg = aggregate(afterRows);
    console.log(`\n삭제 완료 row 수: ${deleted}`);
    printAgg("삭제 후 검증", afterAgg);
    return;
  }

  throw new Error(`알 수 없는 모드: ${mode}`);
}

main().catch((e) => {
  console.error("[recover_outbound_2025_03] error:", e.message ?? e);
  process.exit(1);
});

