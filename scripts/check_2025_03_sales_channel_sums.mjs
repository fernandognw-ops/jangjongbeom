import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

function getEnv(name) {
  const text = fs.readFileSync(".env.local", "utf8");
  const line = text.split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  if (!line) return "";
  return line.split("=").slice(1).join("=").trim().replace(/^"/, "").replace(/"$/, "");
}

const sb = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"));
const from = "2025-03-01";
const to = "2025-04-01";

const r = await sb
  .from("inventory_outbound")
  .select("sales_channel,quantity,unit_price,total_price,outbound_total_amount")
  .gte("outbound_date", from)
  .lt("outbound_date", to);
if (r.error) throw r.error;

const rows = r.data ?? [];
const agg = {};
for (const x of rows) {
  const ch = String(x.sales_channel ?? "NULL").trim() || "NULL";
  if (!agg[ch]) agg[ch] = { rowCount: 0, sumOutboundTotalAmount: 0, sumUnitPriceQty: 0, sumTotalPrice: 0 };
  const qty = Number(x.quantity ?? 0);
  const up = Number(x.unit_price ?? 0);
  const tp = Number(x.total_price ?? 0);
  const ota = Number(x.outbound_total_amount ?? 0);
  agg[ch].rowCount += 1;
  agg[ch].sumOutboundTotalAmount += ota;
  agg[ch].sumUnitPriceQty += qty * up;
  agg[ch].sumTotalPrice += tp;
}

console.log(JSON.stringify({ month: "2025-03", bySalesChannel: agg }, null, 2));
