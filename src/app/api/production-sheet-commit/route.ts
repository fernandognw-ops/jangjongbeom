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
import { chosenOutboundAmount, parseMoney } from "@/lib/outboundAmountSelection";
import { normalizeCode } from "@/lib/inventoryApi";
import { outboundChannelKrFromRow } from "@/lib/inventoryChannels";

const HEADER_SOURCE = "x-source";
const SOURCE_WEB = "web";
const TABLE_UPLOAD_LOGS = "inventory_upload_logs";

function logDbWrite(source: string, table: string, rowCount: number) {
  console.log(`[DB_WRITE] source=${source} table=${table} rows=${rowCount} ts=${new Date().toISOString()}`);
}

function addMonthsYYYYMM(monthStartYYYYMM: string, delta: number): string {
  const [yStr, mStr] = monthStartYYYYMM.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const dt = new Date(Date.UTC(y, m - 1, 1));
  dt.setUTCMonth(dt.getUTCMonth() + delta);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}-01`;
}

async function runPostUploadDashboardValidation(supabase: any, filename: string) {
  try {
    // 1) master unit_cost 맵 (chosenOutboundAmount용)
    const { data: productRows, error: productErr } = await supabase
      .from("inventory_products")
      .select("product_code,unit_cost");
    if (productErr) throw productErr;

    const codeToCost = new Map<string, number>();
    for (const p of productRows ?? []) {
      const raw = String((p as any).product_code ?? "").trim();
      const unit = Number((p as any).unit_cost ?? 0) || 0;
      if (!raw) continue;
      const norm = normalizeCode(raw) || raw;
      if (!codeToCost.has(norm)) codeToCost.set(norm, unit);
      if (!codeToCost.has(raw)) codeToCost.set(raw, unit);
    }

    // 2) month union (inbound/outbound/stock)
    const fetchMonths = async (table: string, dateCol: string) => {
      const { data, error } = await supabase
        .from(table)
        .select(`month_start:date_trunc('month', ${dateCol})::date`)
        .order("month_start", { ascending: true });
      if (error) throw error;
      const set = new Set<string>();
      for (const r of data ?? []) {
        const v = String((r as any).month_start ?? "").slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(v)) set.add(v);
      }
      return Array.from(set);
    };

    const [inMonthsRaw, outMonthsRaw, snapMonthsRaw] = await Promise.all([
      fetchMonths("inventory_inbound", "inbound_date"),
      fetchMonths("inventory_outbound", "outbound_date"),
      fetchMonths("inventory_stock_snapshot", "snapshot_date"),
    ]);

    const monthStarts = Array.from(new Set([...inMonthsRaw, ...outMonthsRaw, ...snapMonthsRaw]))
      .filter((m) => /^\d{4}-\d{2}-\d{2}$/.test(m))
      .sort();

    if (monthStarts.length === 0) {
      console.log("[post-upload validation] month union empty (no rows?)", { filename });
      return;
    }

    const minMonth = monthStarts[0]!;
    const lastMonth = monthStarts[monthStarts.length - 1]!;
    const endExclusive = addMonthsYYYYMM(lastMonth.slice(0, 7), 1);

    // 3) month별 row count (inbound/outbound/sales) + stock은 월의 마지막 snapshot_date 기준
    const countRowsByMonth: Array<{
      month: string;
      inbound_count: number;
      outbound_count: number;
      stock_count: number;
      sales_count: number;
      stock_last_snapshot_date: string | null;
    }> = [];

    const inboundCountByMonth = new Map<string, number>();
    const outboundCountByMonth = new Map<string, number>();
    const stockCountByMonth = new Map<string, { count: number; lastSnapshotDate: string }>();

    for (const mStart of monthStarts) {
      const next = addMonthsYYYYMM(mStart.slice(0, 7), 1);

      const [inCnt, outCnt] = await Promise.all([
        supabase
          .from("inventory_inbound")
          .select("id", { count: "exact", head: true })
          .gte("inbound_date", mStart)
          .lt("inbound_date", next),
        supabase
          .from("inventory_outbound")
          .select("id", { count: "exact", head: true })
          .gte("outbound_date", mStart)
          .lt("outbound_date", next),
      ]);

      const inboundCount = (inCnt as any)?.count ?? 0;
      const outboundCount = (outCnt as any)?.count ?? 0;
      inboundCountByMonth.set(mStart, inboundCount);
      outboundCountByMonth.set(mStart, outboundCount);

      // last snapshot_date within month
      const { data: lastSnapData, error: lastSnapErr } = await supabase
        .from("inventory_stock_snapshot")
        .select("snapshot_date")
        .gte("snapshot_date", mStart)
        .lt("snapshot_date", next)
        .order("snapshot_date", { ascending: false })
        .limit(1);
      if (lastSnapErr) throw lastSnapErr;

      const lastSnapDate = (lastSnapData as any)?.[0]?.snapshot_date
        ? String((lastSnapData as any)[0]?.snapshot_date).slice(0, 10)
        : "";
      if (lastSnapDate) {
        const { count: snapCount, error: snapCountErr } = await supabase
          .from("inventory_stock_snapshot")
          .select("*", { count: "exact", head: true })
          .eq("snapshot_date", lastSnapDate);
        if (snapCountErr) throw snapCountErr;
        stockCountByMonth.set(mStart, { count: snapCount ?? 0, lastSnapshotDate: lastSnapDate });
      } else {
        stockCountByMonth.set(mStart, { count: 0, lastSnapshotDate: "" });
      }
    }

    for (const mStart of monthStarts) {
      const inbound_count = inboundCountByMonth.get(mStart) ?? 0;
      const outbound_count = outboundCountByMonth.get(mStart) ?? 0;
      const stockMeta = stockCountByMonth.get(mStart);
      const stock_count = stockMeta?.count ?? 0;
      const sales_count = outbound_count;
      countRowsByMonth.push({
        month: mStart.slice(0, 7),
        inbound_count,
        outbound_count,
        stock_count,
        sales_count,
        stock_last_snapshot_date: stockMeta?.lastSnapshotDate ? stockMeta.lastSnapshotDate : null,
      });
    }

    // 4) month별 sales_channel별 amount (chosenOutboundAmount + outbound_total_amount)
    //    - chosenOutboundAmount: 기준 C (둘 다 계산하고 선택된 값은 chosen)
    //    - outbound_total_amount: raw 값도 함께 로깅
    const salesAmountByMonthChannel: Record<
      string,
      Record<"쿠팡" | "일반", { chosen_amount: number; outbound_total_amount_sum: number; row_count: number }>
    > = {};

    const initChannel = (month: string) => {
      if (!salesAmountByMonthChannel[month]) {
        salesAmountByMonthChannel[month] = {
          "쿠팡": { chosen_amount: 0, outbound_total_amount_sum: 0, row_count: 0 },
          "일반": { chosen_amount: 0, outbound_total_amount_sum: 0, row_count: 0 },
        };
      }
    };

    const PAGE = 2000;
    let offset = 0;
    let page = 0;
    while (true) {
      if (page > 2000) break; // hard guard

      const { data: outRows, error: outRowsErr } = await supabase
        .from("inventory_outbound")
        .select("id,product_code,quantity,outbound_date,sales_channel,outbound_total_amount,total_price,unit_price")
        .gte("outbound_date", minMonth)
        .lt("outbound_date", endExclusive)
        .order("outbound_date", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + PAGE - 1);

      if (outRowsErr) throw outRowsErr;
      const rows = (outRows ?? []) as Array<any>;
      if (rows.length === 0) break;

      for (const r of rows) {
        const outboundDate = String(r.outbound_date ?? "").slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(outboundDate)) continue;
        const monthKey = outboundDate.slice(0, 7);

        if (!monthStarts.includes(monthKey + "-01")) {
          // union month 밖이면 스킵 (월 축이 DATE_TRUNC 기준이므로 monthKey 검증)
        }

        const sc = outboundChannelKrFromRow(r as Record<string, unknown>);
        initChannel(monthKey);

        const codeKey = normalizeCode(String(r.product_code ?? "")) || String(r.product_code ?? "").trim();
        const chosen = chosenOutboundAmount(
          {
            quantity: r.quantity,
            outbound_total_amount: r.outbound_total_amount,
            total_price: r.total_price,
            unit_price: r.unit_price,
          },
          codeKey,
          codeToCost
        );

        const rawOutboundTotal = parseMoney(r.outbound_total_amount);
        salesAmountByMonthChannel[monthKey][sc].chosen_amount += chosen.amount;
        salesAmountByMonthChannel[monthKey][sc].outbound_total_amount_sum += rawOutboundTotal;
        salesAmountByMonthChannel[monthKey][sc].row_count += 1;
      }

      if (rows.length < PAGE) break;
      offset += PAGE;
      page += 1;
    }

    // 5) month별 stock amount (B: 월의 마지막 snapshot_date 1일만)
    //    - amount 산출은 category-trend와 동일한 fallback 로직 사용 (total_price>0 else qty*unit_cost else master unit_cost)
    const stockAmountByMonth: Record<string, { row_count: number; amount: number; last_snapshot_date: string | null }> = {};

    for (const mStart of monthStarts) {
      const next = addMonthsYYYYMM(mStart.slice(0, 7), 1);
      const { data: lastSnapData } = await supabase
        .from("inventory_stock_snapshot")
        .select("snapshot_date")
        .gte("snapshot_date", mStart)
        .lt("snapshot_date", next)
        .order("snapshot_date", { ascending: false })
        .limit(1);

      const lastSnapDate = (lastSnapData as any)?.[0]?.snapshot_date
        ? String((lastSnapData as any)[0]?.snapshot_date).slice(0, 10)
        : "";
      const monthKey = mStart.slice(0, 7);

      if (!lastSnapDate) {
        stockAmountByMonth[monthKey] = { row_count: 0, amount: 0, last_snapshot_date: null };
        continue;
      }

      const { data: snapRows, error: snapRowsErr } = await supabase
        .from("inventory_stock_snapshot")
        .select("product_code,quantity,unit_cost,total_price,sales_channel,snapshot_date")
        .eq("snapshot_date", lastSnapDate);
      if (snapRowsErr) throw snapRowsErr;

      let row_count = 0;
      let amount = 0;
      for (const r of (snapRows ?? []) as any[]) {
        row_count += 1;
        const qty = Number(r.quantity ?? 0) || 0;
        const cost = Number(r.unit_cost ?? 0) || 0;
        const totalPrice = parseMoney(r.total_price);
        const code = normalizeCode(String(r.product_code ?? "")) || String(r.product_code ?? "").trim();
        const fallbackCost = codeToCost.get(code) ?? codeToCost.get(String(r.product_code ?? "").trim()) ?? 0;
        const val = totalPrice > 0 ? totalPrice : qty * (cost > 0 ? cost : fallbackCost);
        amount += val;
      }

      stockAmountByMonth[monthKey] = { row_count, amount, last_snapshot_date: lastSnapDate };
    }

    // 6) logs (요구사항)
    console.log("[post-upload validation] month row counts", {
      filename,
      monthCount: monthStarts.length,
      counts: countRowsByMonth,
    });

    // missing month logs: 특정 월에서 inbound/outbound/stock 중 하나라도 0이면 즉시 로그
    for (const row of countRowsByMonth) {
      const missing = [];
      if (row.inbound_count === 0) missing.push("inbound");
      if (row.outbound_count === 0) missing.push("outbound");
      if (row.stock_count === 0) missing.push("stock");
      if (missing.length > 0) {
        console.warn("[post-upload validation] missing month rows", { filename, month: row.month, missing });
      }
    }

    // month별 sales_channel별 amount (chosen + raw outbound_total_amount)
    const monthChannelAmountLog = monthStarts.map((mStart) => {
      const monthKey = mStart.slice(0, 7);
      const v = salesAmountByMonthChannel[monthKey] ?? {
        "쿠팡": { chosen_amount: 0, outbound_total_amount_sum: 0, row_count: 0 },
        "일반": { chosen_amount: 0, outbound_total_amount_sum: 0, row_count: 0 },
      };
      return {
        month: monthKey,
        coupang: v["쿠팡"],
        general: v["일반"],
      };
    });
    console.log("[post-upload validation] month sales_channel amounts (chosen + raw)", {
      filename,
      monthChannelAmountLog,
    });

    console.log("[post-upload validation] month stock amount (last snapshot_date only)", {
      filename,
      stockAmountByMonth,
    });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.warn("[post-upload validation] failed:", errMsg);
  }
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

  const snapCheck = data.validation as {
    stockCount?: number;
    snapshotDateValid?: boolean;
    snapshotDateMismatchReason?: string;
    uploadPeriodValid?: boolean;
    outboundDateMismatchReason?: string;
  };
  if (snapCheck.uploadPeriodValid === false) {
    return NextResponse.json(
      {
        error: "업로드 기간(재고·출고 일자) 검증 실패. 파일을 다시 검증하세요.",
        detail:
          [snapCheck.snapshotDateMismatchReason, snapCheck.outboundDateMismatchReason].filter(Boolean).join(" ") ||
          "",
      },
      { status: 400 }
    );
  }
  if ((snapCheck.stockCount ?? 0) > 0 && snapCheck.snapshotDateValid === false) {
    return NextResponse.json(
      {
        error: "재고 snapshot_date 검증 실패. 파일명·재고 시트 기준일을 확인한 뒤 다시 검증하세요.",
        detail: snapCheck.snapshotDateMismatchReason ?? "",
      },
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

    // 업로드 직후 대시보드 기준 검증 로그 (chosenOutboundAmount + outbound_total_amount, stock month 기준 등)
    await runPostUploadDashboardValidation(supabase, data.filename);

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
