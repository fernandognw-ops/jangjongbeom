#!/usr/bin/env node
/**
 * 완전 초기화 검증 스크립트 (read-only)
 * - /api/inventory/quick 0건 확인
 * - 결과 보고 형식 출력
 * - DB insert/upsert 없음 (API GET만 호출)
 *
 * 사용: node scripts/verify_reset_complete.mjs [baseUrl]
 * baseUrl 기본값: http://localhost:3000
 */

import { createRequire } from "module";
const require = createRequire(import.meta.url);

const BASE = process.argv[2] || "http://localhost:3000";

async function main() {
  console.log("=".repeat(60));
  console.log("완전 초기화 검증");
  console.log("=".repeat(60));
  console.log(`API Base: ${BASE}`);
  console.log("");

  let quickRes;
  try {
    quickRes = await fetch(`${BASE}/api/inventory/quick`, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    });
  } catch (e) {
    console.error("API 호출 실패:", e.message);
    console.log("\n→ 개발 서버 실행 중인지 확인: npm run dev");
    process.exit(1);
  }

  const json = await quickRes.json().catch(() => ({}));

  const productCount = json.productCount ?? json.items?.length ?? 0;
  const totalValue = json.totalValue ?? 0;
  const totalQuantity = json.totalQuantity ?? 0;
  const totalSku = json.totalSku ?? 0;
  const error = json.error ?? null;

  const isZero =
    productCount === 0 &&
    totalValue === 0 &&
    totalQuantity === 0 &&
    totalSku === 0;

  // 성공: no_snapshot + 모든 값 0 (DB 초기화 정상)
  // 실패: 값이 하나라도 0이 아님, 또는 error가 no_snapshot이 아님
  const isNoSnapshotEmpty = error === "no_snapshot" && isZero;
  const isSuccess = isZero && (error == null || error === "no_snapshot");
  const isFailure = !isZero || (error != null && error !== "no_snapshot");

  console.log("--- API 응답 (/api/inventory/quick) ---");
  console.log(JSON.stringify(json, null, 2).slice(0, 800));
  if (Object.keys(json).length > 10) console.log("... (생략)");
  console.log("");

  console.log("--- 검증 결과 ---");
  console.log(`  productCount: ${productCount} (기대: 0)`);
  console.log(`  totalValue: ${totalValue} (기대: 0)`);
  console.log(`  totalQuantity: ${totalQuantity} (기대: 0)`);
  console.log(`  totalSku: ${totalSku} (기대: 0)`);
  console.log(`  error: ${error ?? "없음"}`);
  console.log("");

  if (isSuccess) {
    if (isNoSnapshotEmpty) {
      console.log("✅ 초기화 정상 완료. (no_snapshot + 모든 값 0)");
    } else {
      console.log("✅ 초기화 정상 완료. (API 0건 확인됨)");
    }
  } else {
    if (!isZero) {
      console.log("❌ 실패: API가 아직 데이터를 반환함. DB TRUNCATE 후 재확인 필요.");
    } else if (error && error !== "no_snapshot") {
      console.log(`❌ 실패: error="${error}" (Supabase 설정·연결 확인)`);
    } else {
      console.log("❌ 실패: 검증 조건 미충족.");
    }
  }

  console.log("");
  console.log("--- 웹 화면 확인 체크리스트 ---");
  console.log("  1. KPI 카드: 0건, 0원, 0EA, 0박스");
  console.log("  2. 그래프: '최근 12개월 출고 데이터가 없습니다' 또는 empty");
  console.log("  3. 재고 테이블: 빈 상태");
  console.log("  4. localStorage: inventory-* 키 삭제 (새로고침 시 자동 또는 수동)");
  console.log("");
  process.exit(isSuccess ? 0 : 1);
}

main();
