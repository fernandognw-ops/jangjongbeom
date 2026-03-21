#!/usr/bin/env node
/**
 * inventory_sync 테이블 확인
 * - 화면 복원에 영향을 주는지 검증
 * - sync_code(MAIN 등) 기준 백업 데이터 존재 여부
 *
 * 실행: node scripts/check_inventory_sync.mjs
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
  console.error("오류: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY 필요");
  console.error("  .env.local을 로드하거나 환경변수로 설정 후 실행");
  process.exit(1);
}

const supabase = createClient(url, key);

async function main() {
  const { data, error } = await supabase
    .from("inventory_sync")
    .select("sync_code, updated_at, data")
    .order("updated_at", { ascending: false })
    .limit(20);

  if (error) {
    console.error("inventory_sync 조회 실패:", error.message);
    process.exit(1);
  }

  const rows = data ?? [];
  console.log("\n[inventory_sync 테이블]");
  console.log("총 행 수:", rows.length);

  if (rows.length === 0) {
    console.log("→ 데이터 없음. 화면 복원에 영향 없음.");
    return;
  }

  console.log("\n sync_code | updated_at");
  console.log("----------|-------------------");
  for (const r of rows) {
    const code = String(r.sync_code ?? "").slice(0, 12);
    const at = (r.updated_at ?? "").slice(0, 19);
    console.log(` ${code.padEnd(9)} | ${at}`);
  }

  console.log("\n[화면 복원 영향]");
  console.log("- refresh() 실패(fetch_error) 시: getDefaultWorkspaceId() 또는 getStoredSyncCode()가 있으면");
  console.log("  inventory_sync에서 JSON 백업을 가져와 localStorage에 복원 → 이전 데이터 표시");
  console.log("- '로컬 모드로 전환' 클릭 시: 동일 경로로 inventory_sync 복원");
  console.log("\n[정리 방법]");
  console.log("1. Supabase Table Editor → inventory_sync 테이블");
  console.log("2. 불필요한 행 삭제 (SQL: DELETE FROM inventory_sync WHERE sync_code = 'MAIN'; 등)");
  console.log("3. 또는 전체 비우기: TRUNCATE inventory_sync;");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
