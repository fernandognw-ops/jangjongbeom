/**
 * 웹 UI 승인 기반 단일 반영: 2단계 DB 반영
 * POST /api/production-sheet-commit
 * - previewToken 검증 (validate 성공 후 발급)
 * - 승인된 데이터만 DB 반영
 * - validate를 거치지 않은 요청 차단
 */

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { consumePreviewToken } from "@/lib/previewTokenStore";
import { commitProductionSheet, type CommitInput } from "@/lib/commitProductionSheet";

const HEADER_SOURCE = "x-source";
const SOURCE_WEB = "web";
const TABLE_UPLOAD_LOGS = "inventory_upload_logs";

function logDbWrite(source: string, table: string, rowCount: number) {
  console.log(`[DB_WRITE] source=${source} table=${table} rows=${rowCount} ts=${new Date().toISOString()}`);
}

export async function POST(request: Request) {
  const xSource = request.headers.get(HEADER_SOURCE)?.trim().toLowerCase();
  if (xSource !== SOURCE_WEB) {
    return NextResponse.json(
      {
        error: "웹 UI에서만 DB 반영 가능합니다. API 직접 호출·스크립트는 차단됩니다.",
        hint: "대시보드 → Excel 업로드 → 검증 → DB 반영 클릭",
      },
      { status: 403 }
    );
  }

  const allowWrite = process.env.ALLOW_DB_WRITE !== "false";
  if (!allowWrite) {
    console.log(`[DB_WRITE] source=web BLOCKED (ALLOW_DB_WRITE=false) ts=${new Date().toISOString()}`);
    return NextResponse.json(
      {
        error: "DB 쓰기 비활성화 (ALLOW_DB_WRITE=false).",
        hint: ".env.local에서 ALLOW_DB_WRITE=true로 설정 후 재시도",
      },
      { status: 503 }
    );
  }

  let body: { previewToken?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "JSON body 필요. previewToken이 있어야 합니다." },
      { status: 400 }
    );
  }

  const previewToken = body.previewToken?.trim();
  if (!previewToken) {
    return NextResponse.json(
      {
        error: "previewToken 필요. validate API를 먼저 호출해 검증 후 토큰을 받으세요.",
        hint: "대시보드 → 파일 업로드 → 검증 완료 → DB 반영 클릭",
      },
      { status: 400 }
    );
  }

  const data = consumePreviewToken(previewToken);
  if (!data) {
    return NextResponse.json(
      {
        error: "previewToken이 만료되었거나 유효하지 않습니다. 파일을 다시 업로드해 검증해 주세요.",
      },
      { status: 403 }
    );
  }

  if (!data.validation.destWarehouseValid) {
    return NextResponse.json(
      { error: "dest_warehouse 검증 실패. 반영할 수 없습니다." },
      { status: 400 }
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const supabase = createClient(url, key);
  const v = data.validation;
  const whDist = v.destWarehouseDistribution ?? { 일반: 0, 쿠팡: 0 };

  try {
    const input: CommitInput = {
      filename: data.filename,
      inbound: data.inbound as CommitInput["inbound"],
      outbound: data.outbound as CommitInput["outbound"],
      stockSnapshot: data.stockSnapshot as CommitInput["stockSnapshot"],
      rawdata: data.rawdata as CommitInput["rawdata"],
      currentProductCodes: data.currentProductCodes,
    };
    const result = await commitProductionSheet(
      supabase,
      input,
      (table, rows) => logDbWrite("web", table, rows)
    );

    const snapshotDate = v.snapshotDates?.[0] ?? null;
    try {
      await supabase.from(TABLE_UPLOAD_LOGS).insert({
        uploaded_by: "web",
        source: "web",
        filename: data.filename,
        snapshot_date: snapshotDate,
        rawdata_count: v.rawdataCount,
        inbound_count: result.inboundInserted,
        outbound_count: result.outboundInserted,
        stock_count: result.stockSnapshotCount,
        total_value: v.totalStockValue,
        general_count: whDist["일반"] ?? 0,
        coupang_count: whDist["쿠팡"] ?? 0,
        status: "success",
      });
    } catch (logErr) {
      console.warn("[production-sheet-commit] upload_logs insert 실패:", logErr);
    }

    try {
      revalidatePath("/");
    } catch {
      /* ignore */
    }

    return NextResponse.json({
      success: true,
      products: result.products,
      inbound: { inserted: result.inboundInserted },
      outbound: { inserted: result.outboundInserted },
      stockSnapshot: result.stockSnapshotCount,
      currentProducts: result.currentProducts,
    });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : "Unknown error";
    console.error("[production-sheet-commit] error:", e);

    try {
      await supabase.from(TABLE_UPLOAD_LOGS).insert({
        uploaded_by: "web",
        source: "web",
        filename: data.filename,
        rawdata_count: v.rawdataCount,
        inbound_count: 0,
        outbound_count: 0,
        stock_count: 0,
        total_value: v.totalStockValue,
        general_count: whDist["일반"] ?? 0,
        coupang_count: whDist["쿠팡"] ?? 0,
        status: "error",
        error_message: errMsg,
      });
    } catch (logErr) {
      console.warn("[production-sheet-commit] upload_logs(실패) insert 실패:", logErr);
    }

    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
