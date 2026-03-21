#!/usr/bin/env node
/**
 * 로컬 / 배포 / API 3개 일치 검증 (read-only)
 * - API GET만 호출, DB insert/upsert 없음
 *
 * 1. 로컬 API (localhost) 호출
 * 2. 배포 API (vercel.app) 호출
 * 3. _supabase_project_ref, productCount, totalValue 비교
 *
 * 실행: node scripts/verify_supabase_unified.mjs
 * 옵션: VERCEL_URL=https://jangjongbeom.vercel.app (기본값)
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

const LOCAL_URL = process.env.LOCAL_API_URL || "http://localhost:3007";
const DEPLOY_URL = process.env.VERCEL_URL || "https://jangjongbeom.vercel.app";

async function fetchQuick(baseUrl) {
  const url = `${baseUrl}/api/inventory/quick?_t=${Date.now()}`;
  try {
    const res = await fetch(url, { cache: "no-store", headers: { "Cache-Control": "no-cache" } });
    const data = await res.json();
    return { ok: res.ok, data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function main() {
  console.log("\n=== Supabase 통합 검증 ===\n");
  console.log("로컬:", LOCAL_URL);
  console.log("배포:", DEPLOY_URL);
  console.log("");

  const [localRes, deployRes] = await Promise.all([
    fetchQuick(LOCAL_URL),
    fetchQuick(DEPLOY_URL),
  ]);

  const local = localRes.ok ? localRes.data : null;
  const deploy = deployRes.ok ? deployRes.data : null;

  if (!local) {
    console.log("⚠ 로컬 API 실패:", localRes.error || "연결 불가");
    console.log("  → npm run dev 실행 후 재시도");
  } else {
    console.log("[로컬]");
    console.log("  project_ref:", local._supabase_project_ref ?? "(없음)");
    console.log("  productCount:", local.productCount ?? 0);
    console.log("  totalValue:", local.totalValue ?? 0);
    console.log("  items.length:", local.items?.length ?? 0);
  }

  if (!deploy) {
    console.log("\n⚠ 배포 API 실패:", deployRes.error || "연결 불가");
  } else {
    console.log("\n[배포]");
    console.log("  project_ref:", deploy._supabase_project_ref ?? "(없음)");
    console.log("  productCount:", deploy.productCount ?? 0);
    console.log("  totalValue:", deploy.totalValue ?? 0);
    console.log("  items.length:", deploy.items?.length ?? 0);
  }

  console.log("\n[검증 결과]");
  if (local && deploy) {
    const refMatch = local._supabase_project_ref === deploy._supabase_project_ref;
    const countMatch = (local.productCount ?? 0) === (deploy.productCount ?? 0);
    const valueMatch = (local.totalValue ?? 0) === (deploy.totalValue ?? 0);

    if (refMatch && countMatch && valueMatch) {
      console.log("  ✅ 로컬/배포 동일 (project_ref, productCount, totalValue 일치)");
    } else {
      if (!refMatch) console.log("  ❌ project_ref 불일치");
      if (!countMatch) console.log("  ❌ productCount 불일치");
      if (!valueMatch) console.log("  ❌ totalValue 불일치");
    }
  } else {
    console.log("  ⚠ 로컬 또는 배포 API 응답 없음 - 수동 확인 필요");
  }
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
