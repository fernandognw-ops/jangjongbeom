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

const months = ["2025-03", "2025-04"];

const [outboundRes, snapshotRes, logsRes] = await Promise.all([
  sb.from("inventory_outbound").select("outbound_date", { count: "exact" }).gte("outbound_date", "2025-03-01").lt("outbound_date", "2025-05-01"),
  sb.from("inventory_stock_snapshot").select("snapshot_date", { count: "exact" }).gte("snapshot_date", "2025-03-01").lt("snapshot_date", "2025-05-01"),
  sb.from("inventory_upload_logs").select("uploaded_at,filename,status,outbound_count,stock_count,auto_committed,validation_passed,validation_error_reason").order("uploaded_at", { ascending: false }).limit(100),
]);

if (outboundRes.error) throw outboundRes.error;
if (snapshotRes.error) throw snapshotRes.error;
if (logsRes.error) throw logsRes.error;

const outboundByMonth = { "2025-03": 0, "2025-04": 0 };
for (const r of outboundRes.data ?? []) {
  const m = String(r.outbound_date ?? "").slice(0, 7);
  if (outboundByMonth[m] != null) outboundByMonth[m] += 1;
}

const snapshotByMonth = { "2025-03": 0, "2025-04": 0 };
for (const r of snapshotRes.data ?? []) {
  const m = String(r.snapshot_date ?? "").slice(0, 7);
  if (snapshotByMonth[m] != null) snapshotByMonth[m] += 1;
}

const logs = (logsRes.data ?? []).filter((l) => {
  const f = String(l.filename ?? "");
  return f.includes("25년 3월") || f.includes("25년 4월") || f.includes("2025-03") || f.includes("2025-04");
});

const recentByMonth = {};
for (const m of months) {
  const token = m === "2025-03" ? "3월" : "4월";
  recentByMonth[m] = logs.filter((l) => String(l.filename ?? "").includes(token)).slice(0, 5);
}

console.log(
  JSON.stringify(
    {
      outboundRowCount: outboundByMonth,
      stockSnapshotExists: {
        "2025-03": snapshotByMonth["2025-03"] > 0,
        "2025-04": snapshotByMonth["2025-04"] > 0,
      },
      stockSnapshotRowCount: snapshotByMonth,
      uploadLogsRecentByMonth: recentByMonth,
    },
    null,
    2
  )
);
