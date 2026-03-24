import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

function getEnv(name) {
  const text = fs.readFileSync(".env.local", "utf8");
  const line = text.split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  if (!line) return "";
  return line.split("=").slice(1).join("=").trim().replace(/^"/, "").replace(/"$/, "");
}

const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
const key = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
if (!url || !key) throw new Error("Missing Supabase env");

const sb = createClient(url, key);

const snap = await sb
  .from("inventory_stock_snapshot")
  .select("snapshot_date,total_price,quantity,unit_cost,category", { count: "exact" })
  .order("snapshot_date", { ascending: true });
if (snap.error) throw snap.error;

const rows = snap.data ?? [];
const counts = {};
const asset = {};
const datesByMonth = {};
for (const r of rows) {
  const d = String(r.snapshot_date ?? "").slice(0, 10);
  if (!d) continue;
  const m = d.slice(0, 7);
  counts[m] = (counts[m] ?? 0) + 1;
  datesByMonth[m] = datesByMonth[m] ?? new Set();
  datesByMonth[m].add(d);
  const totalPrice = Number(r.total_price ?? 0);
  const qty = Number(r.quantity ?? 0);
  const unitCost = Number(r.unit_cost ?? 0);
  const val = totalPrice > 0 ? totalPrice : qty * unitCost;
  asset[m] = (asset[m] ?? 0) + val;
}

const logs = await sb
  .from("inventory_upload_logs")
  .select("*")
  .order("uploaded_at", { ascending: false })
  .limit(20);
if (logs.error) throw logs.error;

const out = {
  snapshot: {
    rowCount: snap.count ?? rows.length,
    counts,
    asset,
    lastDatesByMonth: Object.fromEntries(
      Object.entries(datesByMonth).map(([k, set]) => [k, [...set].sort().slice(-3)])
    ),
  },
  uploadLogs: logs.data ?? [],
};

console.log(JSON.stringify(out, null, 2));
