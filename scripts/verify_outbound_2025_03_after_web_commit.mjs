#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const envPath = join(root, ".env.local");
const FROM = "2025-03-01";
const TO = "2025-04-01";
const PAGE = 2000;

function loadEnv() {
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}

function num(v) {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

async function fetchAllMarch(supabase) {
  const rows = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("inventory_outbound")
      .select("id,quantity,total_price,sales_channel,dest_warehouse,outbound_date")
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
  const bySales = {};
  const byDest = {};
  let rowCount = 0;
  let sumQty = 0;
  let sumAmount = 0;
  for (const r of rows) {
    rowCount += 1;
    const qty = num(r.quantity);
    const amount = num(r.total_price);
    sumQty += qty;
    sumAmount += amount;

    const sc = String(r.sales_channel ?? "NULL").trim() || "NULL";
    const dw = String(r.dest_warehouse ?? "NULL").trim() || "NULL";

    if (!bySales[sc]) bySales[sc] = { row_cnt: 0, qty: 0, amount: 0 };
    bySales[sc].row_cnt += 1;
    bySales[sc].qty += qty;
    bySales[sc].amount += amount;

    if (!byDest[dw]) byDest[dw] = { row_cnt: 0, qty: 0, amount: 0 };
    byDest[dw].row_cnt += 1;
    byDest[dw].qty += qty;
    byDest[dw].amount += amount;
  }
  return { rowCount, sumQty, sumAmount, bySales, byDest };
}

async function getRecentCommitLog(supabase) {
  const { data, error } = await supabase
    .from("inventory_upload_logs")
    .select("uploaded_at,filename,status,outbound_count,error_message,uploaded_by,source")
    .order("uploaded_at", { ascending: false })
    .limit(5);
  if (error) return { error: error.message, rows: [] };
  return { rows: data ?? [] };
}

async function getDashboardMarch() {
  const bases = [
    process.env.NEXT_PUBLIC_APP_URL,
    "http://localhost:3007",
    "http://localhost:3000",
  ]
    .filter(Boolean)
    .map((s) => String(s).replace(/\/$/, ""));
  for (const base of [...new Set(bases)]) {
    try {
      const res = await fetch(`${base}/api/category-trend?debug=1&_t=${Date.now()}`, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      });
      if (!res.ok) continue;
      const j = await res.json();
      const m = j?.monthlyTotals?.["2025-03"];
      return {
        ok: true,
        base,
        outboundValueCoupang: num(m?.outboundValueCoupang),
        outboundValueGeneral: num(m?.outboundValueGeneral),
        outboundValue: num(m?.outboundValue),
      };
    } catch {
      // try next
    }
  }
  return { ok: false };
}

async function main() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env missing");
  const supabase = createClient(url, key);

  const rows = await fetchAllMarch(supabase);
  const agg = aggregate(rows);
  const logs = await getRecentCommitLog(supabase);
  const dash = await getDashboardMarch();

  const expected = { coupang: 324_136_254, general: 334_607_787 };
  const actualC = num(agg.bySales.coupang?.amount);
  const actualG = num(agg.bySales.general?.amount);

  const out = {
    period: { from: FROM, to: TO },
    commitLogsRecent: logs.rows ?? [],
    commitLogsError: logs.error,
    db: agg,
    excelExpected: expected,
    diffVsExcel: {
      coupang: actualC - expected.coupang,
      general: actualG - expected.general,
    },
    dashboard: dash,
  };
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error("[verify_outbound_2025_03_after_web_commit] error:", e.message ?? e);
  process.exit(1);
});

