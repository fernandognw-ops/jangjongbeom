/**
 * 초고속 로딩 API - inventory_stock_snapshot 단일 테이블만
 * GET /api/inventory/quick
 * - snapshot API보다 단순, products/outbound 조회 없음
 */
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  aggregateSnapshotRowsForDashboard,
  type SnapshotRow,
} from "@/lib/inventorySnapshotAggregate";

function toNum(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Supabase URL에서 프로젝트 ref 추출 (검증용, 노출해도 무방) */
function getProjectRef(url: string | undefined): string {
  if (!url) return "";
  const m = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/);
  return m ? m[1] : "";
}

export async function GET(request: Request) {
  const debug = new URL(request.url).searchParams.get("debug") === "1";
  const _debug = debug ? {} as Record<string, unknown> : undefined;

  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const projectRef = getProjectRef(url);

    if (debug) {
      _debug!.env = { hasUrl: !!url, hasKey: !!key, projectRef };
      _debug!.nodeEnv = process.env.NODE_ENV;
      _debug!.vercel = !!process.env.VERCEL;
    }

    if (!url || !key) {
      return NextResponse.json(
        {
          items: [],
          totalValue: 0,
          totalQuantity: 0,
          totalSku: 0,
          productCount: 0,
          error: "supabase_not_configured",
          _supabase_project_ref: projectRef || null,
          ...(debug && { _debug: { ..._debug, branch: "no_config" } }),
        },
        { status: 200 }
      );
    }

    const supabase = createClient(url, key);
    const tableName = "inventory_stock_snapshot";

    const { data: maxDateRes, error: maxErr } = await supabase
      .from(tableName)
      .select("snapshot_date")
      .order("snapshot_date", { ascending: false })
      .limit(1);

    if (process.env.NODE_ENV === "development") {
      console.log("[quick] query1:", {
        projectRef,
        rowCount: maxDateRes?.length ?? 0,
        maxErr: maxErr?.message ?? null,
        sample: maxDateRes?.[0] ?? null,
      });
    }

    if (debug) {
      _debug!.query1 = {
        table: tableName,
        filter: "order by snapshot_date desc limit 1",
        rowCount: maxDateRes?.length ?? 0,
        maxErr: maxErr?.message ?? null,
        maxDateRes_sample: maxDateRes?.[0] ?? null,
      };
    }

    if (maxErr || !maxDateRes?.length) {
      const fallbackRes = await supabase.from(tableName).select("snapshot_date").limit(500);
      const fallbackDates = (fallbackRes.data ?? [])
        .map((r) => (r as { snapshot_date?: string }).snapshot_date?.slice(0, 10))
        .filter(Boolean) as string[];
      const fallbackMaxDate = fallbackDates.length ? fallbackDates.sort().reverse()[0] : null;
      if (fallbackMaxDate && fallbackRes.data && fallbackRes.data.length > 0) {
        const { data: fallbackData, error: fallbackErr } = await supabase
          .from(tableName)
          .select("product_code,product_name,quantity,pack_size,total_price,unit_cost,dest_warehouse,storage_center,sales_channel,category,snapshot_date")
          .eq("snapshot_date", fallbackMaxDate);
        if (!fallbackErr && fallbackData?.length) {
          const rows = fallbackData as SnapshotRow[];
          const agg = aggregateSnapshotRowsForDashboard(rows, new Map(), undefined, { debug });
          const rowCount = rows.length;
          const snapDate = fallbackMaxDate ?? "";
          const srcCounts = agg.debug_aggregate?.debug_used_channel_source_counts;
          const { debug_aggregate: fbDbg, ...aggRest } = agg;
          return NextResponse.json(
            {
              ...aggRest,
              _supabase_project_ref: projectRef,
              _fallback_used: true,
              ...(debug && {
                snapshot_date: snapDate,
                row_count: rowCount,
                ...(srcCounts && {
                  debug_used_channel_source_counts: {
                    sales_channel_used: srcCounts.sales_channel_used,
                    dest_warehouse_fallback_used: srcCounts.dest_warehouse_fallback_used,
                    ...(typeof srcCounts.empty_source === "number" ? { empty_source: srcCounts.empty_source } : {}),
                  },
                }),
                ...(fbDbg && {
                  _debug: { ...fbDbg, branch: "fallback_max_date", ui_data_path_note: "동일(quick). 이후 snapshot이 channelTotals 덮어쓸 수 있음." },
                }),
              }),
            },
            { headers: { "Cache-Control": "no-store, max-age=0" } }
          );
        }
      }
      return NextResponse.json(
        {
          items: [],
          totalValue: 0,
          totalQuantity: 0,
          totalSku: 0,
          productCount: 0,
          error: maxErr?.message ?? "no_snapshot",
          _supabase_project_ref: projectRef,
          ...(debug && { _debug: { ..._debug, branch: "no_snapshot_or_error" } }),
        },
        { status: 200 }
      );
    }

    const maxDate = (maxDateRes[0] as { snapshot_date?: string }).snapshot_date?.slice(0, 10) ?? "";
    if (!maxDate) {
      return NextResponse.json(
        {
          items: [],
          totalValue: 0,
          totalQuantity: 0,
          totalSku: 0,
          productCount: 0,
          error: "invalid_date",
          _supabase_project_ref: projectRef,
          ...(debug && { _debug: { ..._debug, branch: "invalid_date" } }),
        },
        { status: 200 }
      );
    }

    const { data, error } = await supabase
      .from(tableName)
      .select("product_code,product_name,quantity,pack_size,total_price,unit_cost,dest_warehouse,storage_center,sales_channel,category,snapshot_date")
      .eq("snapshot_date", maxDate);

    if (debug) {
      const rows = (data ?? []) as Array<{ total_price?: unknown }>;
      const sumPrice = rows.reduce((s, r) => s + toNum(r.total_price), 0);
      _debug!.query2 = {
        table: tableName,
        filter: `eq snapshot_date ${maxDate}`,
        rowCount: rows.length,
        sumTotalPrice: Math.round(sumPrice),
        error: error?.message ?? null,
      };
    }

    if (error) {
      return NextResponse.json(
        {
          items: [],
          totalValue: 0,
          totalQuantity: 0,
          totalSku: 0,
          productCount: 0,
          error: error.message,
          _supabase_project_ref: projectRef,
          ...(debug && { _debug: { ..._debug, branch: "query2_error" } }),
        },
        { status: 200 }
      );
    }

    const rows = (data ?? []) as SnapshotRow[];

    const codesNeedingFallback = new Set<string>();
    for (const r of rows) {
      const code = String(r.product_code ?? "").trim();
      const hasName = (r.product_name ?? "").toString().trim();
      const hasCat = (r.category ?? "").toString().trim();
      if (code && (!hasName || !hasCat)) codesNeedingFallback.add(code);
    }
    const productFallback = new Map<string, { product_name: string; category: string }>();
    if (codesNeedingFallback.size > 0) {
      const { data: productsData } = await supabase
        .from("inventory_products")
        .select("product_code,product_name,category,group_name")
        .in("product_code", Array.from(codesNeedingFallback));
      for (const p of productsData ?? []) {
        const code = String((p as { product_code: string }).product_code ?? "").trim();
        const name = String((p as { product_name?: string }).product_name ?? "").trim() || code;
        const cat = String((p as { category?: string }).category ?? (p as { group_name?: string }).group_name ?? "").trim() || "기타";
        if (code) productFallback.set(code, { product_name: name, category: cat });
      }
    }

    const agg = aggregateSnapshotRowsForDashboard(rows, productFallback, undefined, { debug });
    const { items, totalValue, totalQuantity, totalSku, productCount, stockByChannel, channelTotals, debug_aggregate } = agg;

    const srcCounts = debug_aggregate?.debug_used_channel_source_counts;

    if (debug && _debug) {
      _debug.branch = "success";
      _debug.itemsLength = items.length;
      _debug.productCount = productCount;
      _debug.totalValue = totalValue;
      _debug.rowCount = rows.length;
      _debug.sumQuantityRows = rows.reduce((s, r) => s + toNum(r.quantity), 0);
      _debug.sumQuantityEqualsTotalQty = _debug.sumQuantityRows === totalQuantity;
      if (debug_aggregate) {
        Object.assign(_debug, debug_aggregate);
      }
      _debug.ui_data_path_note =
        "Dashboard 상단·하단 채널 수치는 InventoryContext.refresh()가 먼저 이 quick 응답의 channelTotals를 쓰고, 이어서 /api/inventory/snapshot(비-lite)가 성공하면 channelTotals를 덮어쓸 수 있음. 수치가 다르면 snapshot 응답과 비교할 것.";
    }

    return NextResponse.json(
      {
        items,
        totalValue,
        totalQuantity,
        totalSku,
        productCount,
        stockByChannel,
        channelTotals,
        /** @deprecated 호환용 — channelTotals와 동일(dest_warehouse=판매채널) */
        stockByWarehouse: channelTotals,
        _supabase_project_ref: projectRef,
        ...(debug && {
          snapshot_date: maxDate,
          row_count: rows.length,
          ...(srcCounts && {
            debug_used_channel_source_counts: {
              sales_channel_used: srcCounts.sales_channel_used,
              dest_warehouse_fallback_used: srcCounts.dest_warehouse_fallback_used,
              ...(typeof srcCounts.empty_source === "number" ? { empty_source: srcCounts.empty_source } : {}),
            },
          }),
        }),
        ...(debug && { _debug }),
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    return NextResponse.json(
      {
        items: [],
        totalValue: 0,
        totalQuantity: 0,
        totalSku: 0,
        productCount: 0,
        error: err,
        _supabase_project_ref: getProjectRef(url),
        ...(debug && { _debug: { ..._debug, branch: "catch", error: err } }),
      },
      { status: 200 }
    );
  }
}
