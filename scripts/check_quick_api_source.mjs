#!/usr/bin/env node
/**
 * /api/inventory/quick 데이터 소스 확인
 * - API project ref
 * - Supabase URL (마스킹)
 * - SQL 실행 시 참고용
 *
 * 사용: node scripts/check_quick_api_source.mjs [baseUrl]
 */
const BASE = process.argv[2] || "http://localhost:3007";

async function main() {
  const res = await fetch(`${BASE}/api/inventory/quick?debug=1`, {
    cache: "no-store",
    headers: { "Cache-Control": "no-cache" },
  });
  const json = await res.json();

  const ref = json._supabase_project_ref ?? "(없음)";
  const productCount = json.productCount ?? 0;
  const error = json.error ?? null;

  console.log("=== /api/inventory/quick 데이터 소스 확인 ===\n");
  console.log("API project ref:", ref);
  console.log("Supabase URL:", `https://${ref}.supabase.co`);
  console.log("productCount:", productCount);
  console.log("error:", error ?? "없음");
  console.log("\n조회 테이블: inventory_stock_snapshot");
  console.log("\n--- Supabase SQL Editor에서 확인 ---");
  console.log("1. 프로젝트 URL: https://supabase.com/dashboard/project/" + ref);
  console.log("2. row count 확인 SQL:");
  console.log("   SELECT COUNT(*) FROM inventory_stock_snapshot;");
  console.log("\n3. project ref 일치 확인: URL에 '" + ref + "' 포함되어야 함");
}

main().catch(console.error);
