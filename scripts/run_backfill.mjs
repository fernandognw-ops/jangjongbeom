#!/usr/bin/env node
/**
 * backfill_inventory_from_products.sql 실행
 * DATABASE_URL 또는 SUPABASE_DB_URL 필요
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

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

const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error("오류: DATABASE_URL 또는 SUPABASE_DB_URL 필요 (.env.local)");
  process.exit(1);
}

async function run() {
  const { default: pg } = await import("pg");
  const sql = readFileSync(join(__dirname, "backfill_inventory_from_products.sql"), "utf-8");
  const client = new pg.Client({ connectionString: dbUrl });
  try {
    await client.connect();
    await client.query(sql);
    console.log("backfill 완료.");
  } catch (e) {
    console.error("backfill 실패:", e.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
