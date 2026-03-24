import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

function getEnv(name) {
  const text = fs.readFileSync(".env.local", "utf8");
  const line = text.split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  if (!line) return "";
  return line.split("=").slice(1).join("=").trim().replace(/^"/, "").replace(/"$/, "");
}

const EXCEL_TOTAL_2025_03 = 658740810;

const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
const key = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
if (!url || !key) throw new Error("Missing Supabase env");
const sb = createClient(url, key);

const res = await sb
  .from("inventory_outbound")
  .select("id,outbound_date,quantity,unit_price,total_price,outbound_total_amount", { count: "exact" })
  .gte("outbound_date", "2025-03-01")
  .lt("outbound_date", "2025-04-01");
if (res.error) throw res.error;

const rows = res.data ?? [];
let sumOutboundTotalAmount = 0;
let sumUnitPriceQty = 0;
let eqOutboundUnitCnt = 0;
const sourceCnt = {
  outbound_total_amount: 0,
  total_price: 0,
  unit_price_x_qty_or_fallback: 0,
};

for (const r of rows) {
  const q = Number(r.quantity ?? 0);
  const up = Number(r.unit_price ?? 0);
  const tp = Number(r.total_price ?? 0);
  const ota = Number(r.outbound_total_amount ?? 0);
  sumOutboundTotalAmount += ota;
  sumUnitPriceQty += q * up;
  if (Math.abs(ota - up) < 1e-9) eqOutboundUnitCnt += 1;

  if (ota > 0) sourceCnt.outbound_total_amount += 1;
  else if (tp > 0) sourceCnt.total_price += 1;
  else sourceCnt.unit_price_x_qty_or_fallback += 1;
}

const diffVsExcel = Math.round(sumOutboundTotalAmount - EXCEL_TOTAL_2025_03);
const out = {
  month: "2025-03",
  rowCount: res.count ?? rows.length,
  sumOutboundTotalAmount,
  sumUnitPriceQty,
  countOutboundTotalEqualsUnitPrice: eqOutboundUnitCnt,
  chosenSourceCount: sourceCnt,
  excelTotal: EXCEL_TOTAL_2025_03,
  diffDbOutboundTotalMinusExcel: diffVsExcel,
};
console.log(JSON.stringify(out, null, 2));
