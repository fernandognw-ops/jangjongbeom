#!/usr/bin/env node
/**
 * 출고 병합 제거 - 마이그레이션 실행
 * 1. --execute: DATABASE_URL 있으면 pg로 마이그레이션 실행
 * 2. Supabase SQL Editor에서 수동 실행 (DATABASE_URL 없을 때)
 *
 * 사용법:
 *   node scripts/run_outbound_migration.mjs          # 상태 확인 + SQL 안내
 *   node scripts/run_outbound_migration.mjs --execute # pg로 마이그레이션 실행 (DATABASE_URL 필요)
 *   node scripts/run_outbound_migration.mjs --verify  # 최종 검증
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

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

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error("오류: .env.local에 NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY 필요");
  process.exit(1);
}

const supabase = createClient(url, key);

async function getCount(table) {
  const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });
  if (error) return { error: error.message };
  return { count: count ?? 0 };
}

async function main() {
  console.log("\n=== 출고 병합 제거 - 마이그레이션 상태 확인 ===\n");

  // 1. 현재 DB row 수
  const tables = [
    "inventory_products",
    "inventory_inbound",
    "inventory_outbound",
    "inventory_stock_snapshot",
  ];
  const counts = {};
  for (const t of tables) {
    const r = await getCount(t);
    counts[t] = r.error ?? r.count;
  }

  console.log("1. 현재 DB row 수:");
  console.log("   inventory_products:", counts.inventory_products);
  console.log("   inventory_inbound:", counts.inventory_inbound);
  console.log("   inventory_outbound:", counts.inventory_outbound);
  console.log("   inventory_stock_snapshot:", counts.inventory_stock_snapshot);

  // 2. 마이그레이션 SQL 안내
  const migrationPath = join(__dirname, "migrate_outbound_no_merge.sql");
  const sql = readFileSync(migrationPath, "utf-8");
  console.log("\n2. 마이그레이션 실행 안내:");
  console.log("   Supabase 대시보드 → SQL Editor → New query");
  console.log("   scripts/migrate_outbound_no_merge.sql 내용 붙여넣기 → Run");
  console.log("   (또는 아래 SQL 복사)\n");
  console.log("---");
  console.log(sql.trim());
  console.log("---\n");

  // 3. 기존 outbound 정리 옵션
  const outboundCount = typeof counts.inventory_outbound === "number" ? counts.inventory_outbound : 0;
  if (outboundCount > 0 && outboundCount < 2965) {
    console.log("3. 참고: 현재 outbound", outboundCount, "건 (병합된 상태일 수 있음)");
    console.log("   → Excel 재업로드 시 해당 날짜 범위 데이터가 교체됩니다.");
  }

  console.log("\n4. 다음 단계:");
  console.log("   - 마이그레이션 SQL 실행 후");
  console.log("   - 대시보드에서 Excel 업로드 → 검증 (rawdata 480, inbound 172, outbound 2965, stock 414)");
  console.log("   - 수치 일치 시 DB 반영 클릭");
  console.log("   - node scripts/run_outbound_migration.mjs --verify 로 최종 확인\n");
}

async function verify() {
  console.log("\n=== 출고 병합 제거 - 최종 검증 ===\n");
  const tables = [
    "inventory_products",
    "inventory_inbound",
    "inventory_outbound",
    "inventory_stock_snapshot",
  ];
  const counts = {};
  for (const t of tables) {
    const r = await getCount(t);
    counts[t] = r.error ?? r.count;
  }
  console.log("DB row 수:");
  console.log("  inventory_products:", counts.inventory_products, "(기대: 480)");
  console.log("  inventory_inbound:", counts.inventory_inbound, "(기대: 172)");
  console.log("  inventory_outbound:", counts.inventory_outbound, "(기대: 2965)");
  console.log("  inventory_stock_snapshot:", counts.inventory_stock_snapshot, "(기대: 414)");

  const ok =
    counts.inventory_outbound === 2965 &&
    counts.inventory_products === 480 &&
    counts.inventory_inbound === 172 &&
    counts.inventory_stock_snapshot === 414;
  console.log("\n검증:", ok ? "통과" : "불일치 (기대값과 비교)");
}

async function executeMigration() {
  const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    console.error("오류: DATABASE_URL 또는 SUPABASE_DB_URL 필요");
    console.error("Supabase 대시보드 → Project Settings → Database → Connection string (URI) 복사");
    console.error(".env.local에 DATABASE_URL=postgresql://... 추가");
    process.exit(1);
  }
  const migrationPath = join(__dirname, "migrate_outbound_no_merge.sql");
  const sql = readFileSync(migrationPath, "utf-8");
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: dbUrl });
  try {
    await client.connect();
    await client.query(sql);
    console.log("마이그레이션 실행 완료.");
  } catch (e) {
    console.error("마이그레이션 실패:", e.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

const isVerify = process.argv.includes("--verify");
const isExecute = process.argv.includes("--execute");
if (isExecute) {
  executeMigration().catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else if (isVerify) {
  verify().catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
