import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

function envFromFile(name) {
  const text = fs.readFileSync(".env.local", "utf8");
  const line = text.split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  if (!line) return "";
  return line.split("=").slice(1).join("=").trim().replace(/^"/, "").replace(/"$/, "");
}
function parseMoney(v) {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v).replace(/,/g, "").replace(/\s/g, "").trim();
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}
function monthKey(d) {
  return String(d ?? "").slice(0, 7);
}
function normalizeCode(code) {
  return String(code ?? "").trim().replace(/\s+/g, "");
}
function chosen(row, masterCost) {
  const qty = Number(row.quantity ?? 0);
  const ota = parseMoney(row.outbound_total_amount);
  const tp = parseMoney(row.total_price);
  const up = parseMoney(row.unit_price);
  if (ota > 0) return { amount: ota, source: "outbound_total_amount" };
  if (tp > 0) return { amount: tp, source: "total_price" };
  if (up > 0 && qty > 0) return { amount: up * qty, source: "unit_price_x_qty" };
  if (masterCost > 0 && qty > 0) return { amount: masterCost * qty, source: "master_unit_cost_x_qty" };
  return { amount: 0, source: "fallback_0" };
}

const url = envFromFile("NEXT_PUBLIC_SUPABASE_URL");
const key = envFromFile("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const sb = createClient(url, key);

const month = process.argv[2] || "2025-04";
const latestMonth = "2026-03";
const months = ["2025-03", "2025-04", latestMonth];
const excelAnswer = {
  "2025-03": 658740810,
  "2025-04": 620477306,
  "2026-03": null,
};

const [{ data: products }, outboundRes] = await Promise.all([
  sb.from("inventory_products").select("product_code,unit_cost").limit(10000),
  sb
    .from("inventory_outbound")
    .select("outbound_date,sales_channel,product_code,product_name,quantity,total_price,unit_price,outbound_total_amount"),
]);
let outbound = outboundRes?.data ?? [];
if (outboundRes?.error) {
  const fallback = await sb
    .from("inventory_outbound")
    .select("outbound_date,sales_channel,product_code,product_name,quantity,total_price,unit_price");
  outbound = fallback.data ?? [];
}
const costMap = new Map((products ?? []).map((p) => [normalizeCode(p.product_code), Number(p.unit_cost ?? 0)]));

const rows = (outbound ?? []).filter((r) => months.includes(monthKey(r.outbound_date)));

const monthAgg = {};
for (const m of months) {
  monthAgg[m] = {
    sumTotalPrice: 0,
    sumUnitPriceXQty: 0,
    sumMasterUnitCostXQty: 0,
    sumOutboundTotalAmount: 0,
    categoryTrendCurrent: 0,
  };
}
for (const r of rows) {
  const m = monthKey(r.outbound_date);
  const qty = Number(r.quantity ?? 0);
  const code = normalizeCode(r.product_code);
  const master = Number(costMap.get(code) ?? 0);
  monthAgg[m].sumTotalPrice += parseMoney(r.total_price);
  monthAgg[m].sumUnitPriceXQty += parseMoney(r.unit_price) * qty;
  monthAgg[m].sumMasterUnitCostXQty += master * qty;
  monthAgg[m].sumOutboundTotalAmount += parseMoney(r.outbound_total_amount);
  monthAgg[m].categoryTrendCurrent += chosen(r, master).amount;
}

const sampleRows = rows
  .filter((r) => monthKey(r.outbound_date) === month)
  .slice(0, 30)
  .map((r) => {
    const code = normalizeCode(r.product_code);
    const master = Number(costMap.get(code) ?? 0);
    const c = chosen(r, master);
    return {
      outbound_date: r.outbound_date,
      sales_channel: r.sales_channel,
      product_name: r.product_name,
      quantity: r.quantity,
      total_price: r.total_price,
      outbound_total_amount: r.outbound_total_amount,
      unit_price: r.unit_price,
      master_unit_cost: master,
      chosen_amount: c.amount,
      chosenOutboundAmountSource: c.source,
    };
  });

const compare = months.map((m) => ({
  month: m,
  a_sum_total_price: Math.round(monthAgg[m].sumTotalPrice),
  b_sum_unit_price_x_qty: Math.round(monthAgg[m].sumUnitPriceXQty),
  c_sum_master_unit_cost_x_qty: Math.round(monthAgg[m].sumMasterUnitCostXQty),
  d_current_category_trend: Math.round(monthAgg[m].categoryTrendCurrent),
  outbound_total_amount_sum: Math.round(monthAgg[m].sumOutboundTotalAmount),
  e_excel_answer: excelAnswer[m],
}));

console.log(
  JSON.stringify(
    {
      month,
      sampleRows,
      monthlyComparison: compare,
    },
    null,
    2
  )
);
