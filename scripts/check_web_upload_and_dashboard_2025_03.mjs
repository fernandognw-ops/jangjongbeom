#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const envPath = join(root, ".env.local");

function loadEnv() {
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}

async function main() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const app = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3007").replace(/\/$/, "");
  if (!url || !key) {
    console.log("NO_SUPABASE_ENV");
    process.exit(0);
  }
  const supabase = createClient(url, key);

  const { data: sample, error: sampleErr } = await supabase
    .from("inventory_upload_logs")
    .select("*")
    .limit(1);
  if (sampleErr) {
    console.log("[upload_logs] sample error:", sampleErr.message);
  } else {
    const keys = Object.keys((sample ?? [])[0] ?? {});
    console.log("[upload_logs columns]", keys);
    const orderCol = keys.includes("created_at")
      ? "created_at"
      : keys.includes("uploaded_at")
        ? "uploaded_at"
        : null;
    let q = supabase
      .from("inventory_upload_logs")
      .select("filename,status,outbound_count,error_message,uploaded_by,source");
    if (orderCol) q = q.order(orderCol, { ascending: false });
    const { data: logs, error: logErr } = await q.limit(10);
    if (logErr) {
      console.log("[upload_logs] error:", logErr.message);
    } else {
      console.log("[upload_logs recent]");
      console.log(JSON.stringify(logs ?? [], null, 2));
    }
  }

  try {
    const res = await fetch(`${app}/api/category-trend?debug=1&_t=${Date.now()}`, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
    });
    const json = await res.json();
    const march = json?.monthlyTotals?.["2025-03"] ?? null;
    console.log("\n[category-trend 2025-03]");
    console.log(
      JSON.stringify(
        {
          ok: res.ok,
          app,
          marchMonthlyTotals: march,
          thisMonthIndicators: json?.momIndicators ?? null,
        },
        null,
        2
      )
    );
  } catch (e) {
    console.log("[category-trend] error:", e instanceof Error ? e.message : String(e));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

