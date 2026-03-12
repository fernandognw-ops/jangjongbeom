#!/usr/bin/env node
/**
 * 테이블 리셋 + 0311 엑셀 기준 완전 재업로드
 *
 * 1. inventory_stock_snapshot, inventory_discontinued_stock_snapshot TRUNCATE
 * 2. 엑셀 '재고' 시트 품목코드→product_code, 품목구분→category 매핑으로 재업로드
 *
 * 사용법:
 *   node scripts/reset-and-reupload.mjs "경로/26년 0311_생산수불현황.xlsx"
 */

import { readFileSync, existsSync } from "fs";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function loadEnv() {
  const envPath = join(root, ".env.local");
  if (!existsSync(envPath)) {
    console.error("오류: .env.local이 없습니다.");
    process.exit(1);
  }
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) {
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

/** 테이블 전체 삭제 (TRUNCATE 대체 - Supabase JS는 TRUNCATE 미지원) */
async function truncateTable(supabase, tableName, pkColumn = "product_code") {
  let total = 0;
  const LIMIT = 500;
  while (true) {
    const { data, error } = await supabase
      .from(tableName)
      .select(pkColumn)
      .limit(LIMIT);

    if (error) {
      console.warn(`    ${tableName} 조회 실패: ${error.message}`);
      break;
    }
    if (!data || data.length === 0) break;

    const values = data.map((r) => r[pkColumn]).filter((v) => v != null);
    if (values.length === 0) break;

    const { error: delErr } = await supabase.from(tableName).delete().in(pkColumn, values);
    if (delErr) {
      console.warn(`    ${tableName} 삭제 실패: ${delErr.message}`);
      break;
    }
    total += data.length;
    process.stdout.write(`\r    ${tableName}: ${total}행 삭제됨`);
  }
  if (total > 0) console.log("");
  return total;
}

async function main() {
  loadEnv();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error("오류: .env.local에 NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY 필요");
    process.exit(1);
  }

  const input = process.argv[2];
  if (!input) {
    console.error("사용법: node scripts/reset-and-reupload.mjs <0311 엑셀파일경로>");
    console.error('예: node scripts/reset-and-reupload.mjs "26년 0311_생산수불현황.xlsx"');
    process.exit(1);
  }

  const absPath = resolve(process.cwd(), input);
  if (!existsSync(absPath)) {
    console.error(`오류: 파일 없음 - ${absPath}`);
    process.exit(1);
  }

  const supabase = createClient(url, key);

  console.log("[1] 테이블 초기화 (TRUNCATE)");
  const t1 = await truncateTable(supabase, "inventory_stock_snapshot");
  const t2 = await truncateTable(supabase, "inventory_discontinued_stock_snapshot");
  console.log(`    inventory_stock_snapshot: ${t1}행 삭제`);
  console.log(`    inventory_discontinued_stock_snapshot: ${t2}행 삭제`);
  console.log("    완료.\n");

  console.log("[2] 0311 엑셀 업로드 (품목코드→product_code, 품목구분→category)");
  console.log("    npm run dev 실행 중이어야 합니다. bulk-upload 실행...\n");

  const { spawnSync } = await import("child_process");
  const bulkScript = join(root, "scripts", "bulk-upload-production-sheet.mjs");
  const result = spawnSync("node", [bulkScript, absPath], {
    stdio: "inherit",
    cwd: root,
    env: { ...process.env, FORCE_RESET: "1" },
  });

  if (result.status !== 0) {
    console.error("\n업로드 실패.");
    process.exit(1);
  }

  console.log("\n[3] 완료.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
