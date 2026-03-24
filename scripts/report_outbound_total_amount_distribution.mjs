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

const { data, error } = await sb
  .from("inventory_outbound")
  .select("id,outbound_date,sales_channel,product_name,quantity,unit_price,total_price,outbound_total_amount")
  .gte("outbound_date", "2025-03-01")
  .lt("outbound_date", "2025-05-01")
  .order("outbound_date", { ascending: true })
  .order("id", { ascending: true });
if (error) throw error;

function analyze(month) {
  const rows = (data ?? []).filter((r) => String(r.outbound_date ?? "").slice(0, 7) === month);
  const arr = rows.map((r) => Number(r.outbound_total_amount ?? 0));
  const count = arr.length;
  const min = count ? Math.min(...arr) : 0;
  const max = count ? Math.max(...arr) : 0;
  const avg = count ? arr.reduce((a, b) => a + b, 0) / count : 0;
  const lt1000 = arr.filter((v) => v < 1000).length;
  const btw = arr.filter((v) => v >= 1000 && v < 10000).length;
  const sortedAsc = [...rows].sort((a, b) => Number(a.outbound_total_amount ?? 0) - Number(b.outbound_total_amount ?? 0));
  const sortedDesc = [...rows].sort((a, b) => Number(b.outbound_total_amount ?? 0) - Number(a.outbound_total_amount ?? 0));
  return {
    month,
    count,
    min,
    max,
    avg,
    lt1000,
    between1000_10000: btw,
    top20: sortedDesc.slice(0, 20).map((r) => ({
      outbound_date: r.outbound_date,
      sales_channel: r.sales_channel,
      product_name: r.product_name,
      quantity: r.quantity,
      unit_price: r.unit_price,
      total_price: r.total_price,
      outbound_total_amount: r.outbound_total_amount,
    })),
    bottom20: sortedAsc.slice(0, 20).map((r) => ({
      outbound_date: r.outbound_date,
      sales_channel: r.sales_channel,
      product_name: r.product_name,
      quantity: r.quantity,
      unit_price: r.unit_price,
      total_price: r.total_price,
      outbound_total_amount: r.outbound_total_amount,
    })),
  };
}

console.log(JSON.stringify({ report: [analyze("2025-03"), analyze("2025-04")] }, null, 2));
