import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

function getEnv(name) {
  const text = fs.readFileSync(".env.local", "utf8");
  const line = text.split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  if (!line) return "";
  return line.split("=").slice(1).join("=").trim().replace(/^"/, "").replace(/"$/, "");
}

const mode = process.argv[2] || "check";
const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
const key = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
if (!url || !key) throw new Error("Missing Supabase env");
const sb = createClient(url, key);

async function check() {
  const res = await sb
    .from("inventory_outbound")
    .select("id,outbound_date,quantity,unit_price,total_price,outbound_total_amount", { count: "exact" })
    .gte("outbound_date", "2025-03-01")
    .lt("outbound_date", "2025-04-01");
  if (res.error) throw res.error;
  const rows = res.data ?? [];
  let sumOta = 0;
  let sumUnitQty = 0;
  for (const x of rows) {
    const q = Number(x.quantity ?? 0);
    const u = Number(x.unit_price ?? 0);
    const o = Number(x.outbound_total_amount ?? 0);
    sumOta += o;
    sumUnitQty += q * u;
  }
  console.log(
    JSON.stringify(
      {
        month: "2025-03",
        rowCount: res.count ?? rows.length,
        sumOutboundTotalAmount: sumOta,
        sumUnitPriceQty: sumUnitQty,
      },
      null,
      2
    )
  );
}

async function removeAll() {
  const del = await sb
    .from("inventory_outbound")
    .delete()
    .gte("outbound_date", "2025-03-01")
    .lt("outbound_date", "2025-04-01");
  if (del.error) throw del.error;
  console.log(JSON.stringify({ deletedMonth: "2025-03", status: "ok" }, null, 2));
}

if (mode === "check") {
  await check();
} else if (mode === "delete") {
  await removeAll();
  await check();
} else {
  throw new Error("Unknown mode. Use check | delete");
}
