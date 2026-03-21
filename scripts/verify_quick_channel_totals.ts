/**
 * quick API와 동일 로직으로 channelTotals·totalQuantity·totalValue 검증 (read-only)
 * 실행: npx tsx scripts/verify_quick_channel_totals.ts
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import {
  aggregateSnapshotRowsForDashboard,
  type SnapshotRow,
} from "../src/lib/inventorySnapshotAggregate";

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

function toNum(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error(JSON.stringify({ ok: false, error: "missing NEXT_PUBLIC_SUPABASE_URL or ANON_KEY in .env.local" }));
    process.exit(1);
  }

  const supabase = createClient(url, key);
  const tableName = "inventory_stock_snapshot";

  const { data: maxDateRes, error: maxErr } = await supabase
    .from(tableName)
    .select("snapshot_date")
    .order("snapshot_date", { ascending: false })
    .limit(1);

  if (maxErr || !maxDateRes?.length) {
    console.error(JSON.stringify({ ok: false, error: maxErr?.message ?? "no max date" }));
    process.exit(2);
  }

  const maxDate = String((maxDateRes[0] as { snapshot_date?: string }).snapshot_date ?? "").slice(0, 10);
  const { data: rows, error: q2 } = await supabase
    .from(tableName)
    .select("product_code,product_name,quantity,pack_size,total_price,unit_cost,dest_warehouse,sales_channel,category,snapshot_date")
    .eq("snapshot_date", maxDate);

  if (q2 || !rows?.length) {
    console.error(JSON.stringify({ ok: false, error: q2?.message ?? "no rows", maxDate }));
    process.exit(3);
  }

  const snapshotRows = rows as SnapshotRow[];
  const agg = aggregateSnapshotRowsForDashboard(snapshotRows, new Map());

  const sumQtyRaw = snapshotRows.reduce((s, r) => s + toNum(r.quantity), 0);
  const sumPriceRows = snapshotRows.reduce((s, r) => {
    let p = toNum(r.total_price);
    const q = toNum(r.quantity);
    if (p <= 0 && q > 0) p = q * toNum(r.unit_cost);
    return s + p;
  }, 0);

  const ch = agg.channelTotals;
  const coupang = ch["쿠팡"] ?? 0;
  const general = ch["일반"] ?? 0;
  const channelSum = Object.values(ch).reduce((a, b) => a + b, 0);
  const totalQty = agg.totalQuantity;
  const totalVal = agg.totalValue;

  const qtyMatchChannel = coupang + general === totalQty;
  const qtyMatchRaw = sumQtyRaw === totalQty;
  const channelKeysOnlySum = coupang + general === channelSum; // should hold if only 쿠팡/일반 keys

  console.log(
    JSON.stringify(
      {
        ok: true,
        snapshot_date: maxDate,
        rowCount: snapshotRows.length,
        api_equivalent: {
          channelTotals: agg.channelTotals,
          totalQuantity: totalQty,
          totalValue: totalVal,
          productCount: agg.productCount,
        },
        checks: {
          sumQuantityRows_equals_totalQuantity: sumQtyRaw === totalQty,
          coupang_plus_general_equals_totalQuantity: coupang + general === totalQty,
          totalValue_equals_sum_row_prices_merged_logic: "see note — quick uses merged-by-product total_price; compare totalValue to agg only",
        },
        row_level: {
          sumQuantity_all_rows: sumQtyRaw,
          sumPrice_rows_naive_if_negative_use_unit: Math.round(sumPriceRows),
        },
        _debug: {
          sumQuantityRows: sumQtyRaw,
          sumQuantityEqualsTotalQty: sumQtyRaw === totalQty,
        },
      },
      null,
      2
    )
  );

  // totalValue in aggregate is from merged products, not raw sum of rows — verify merged
  let mergedSum = 0;
  for (const i of agg.items) mergedSum += toNum(i.total_price);
  const valueMatch = Math.round(mergedSum) === totalVal;

  console.log(
    "\n--- 추가 검증 ---\n" +
      JSON.stringify(
        {
          items_total_price_sum: Math.round(mergedSum),
          agg_totalValue: totalVal,
          totalValue_matches_items_sum: valueMatch,
        },
        null,
        2
      )
  );

  process.exit(qtyMatchRaw && qtyMatchChannel && valueMatch ? 0 : 4);
}

main().catch((e) => {
  console.error(e);
  process.exit(99);
});
