import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

function getEnv(name) {
  const text = fs.readFileSync(".env.local", "utf8");
  const line = text.split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  if (!line) return "";
  return line.split("=").slice(1).join("=").trim().replace(/^"/, "").replace(/"$/, "");
}

const sb = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"));

const ranges = [
  { key: "2025-03", from: "2025-03-01", to: "2025-04-01" },
  { key: "2025-04", from: "2025-04-01", to: "2025-05-01" },
  { key: "2026-03", from: "2026-03-01", to: "2026-04-01" },
];

async function count(table, col, from, to) {
  const r = await sb.from(table).select("id", { count: "exact", head: true }).gte(col, from).lt(col, to);
  if (r.error) throw r.error;
  return r.count ?? 0;
}

const out = {};
for (const m of ranges) {
  out[m.key] = {
    outbound: await count("inventory_outbound", "outbound_date", m.from, m.to),
    inbound: await count("inventory_inbound", "inbound_date", m.from, m.to),
    snapshot: await count("inventory_stock_snapshot", "snapshot_date", m.from, m.to),
  };
}
console.log(JSON.stringify(out, null, 2));
