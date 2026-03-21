/**
 * KPI API - inventory_stock_snapshot 최신 snapshot_date만 사용
 * - 총 재고 금액: SUM(total_price)
 * - 총 재고 수량(EA): SUM(quantity)
 * - 품목 수: product_code 고유 수
 * - SKU(박스): SUM(quantity/pack_size)
 */
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  aggregateSnapshotRowsForDashboard,
  type SnapshotRow,
} from "@/lib/inventorySnapshotAggregate";

const TABLE_SNAPSHOT = "inventory_stock_snapshot";
const TABLE_PRODUCTS = "inventory_products";

function toNum(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const NO_CACHE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

export async function GET() {
  const start = Date.now();
  const log = (msg: string, extra?: Record<string, unknown>) => {
    console.log(`[api/inventory/kpi] ${msg} (${Date.now() - start}ms)`, extra ?? "");
  };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return NextResponse.json(
      { productCount: 0, totalValue: 0, totalQuantity: 0, totalSku: 0, error: "supabase_not_configured" },
      { status: 200, headers: NO_CACHE }
    );
  }

  const supabase = createClient(url, key);

  try {
    // 1. 최신 snapshot_date만 조회 (limit 없이 해당 날짜만 필터)
    const { data: maxDateRes, error: maxErr } = await supabase
      .from(TABLE_SNAPSHOT)
      .select("snapshot_date")
      .order("snapshot_date", { ascending: false })
      .limit(1);

    if (maxErr || !maxDateRes?.length) {
      log("KPI 에러 (날짜 조회)", { error: maxErr?.message ?? "empty" });
      return NextResponse.json(
        { productCount: 0, totalValue: 0, totalQuantity: 0, totalSku: 0, error: maxErr?.message ?? "no_snapshot" },
        { status: 200, headers: NO_CACHE }
      );
    }

    const maxDate = (maxDateRes[0] as { snapshot_date?: string }).snapshot_date?.slice(0, 10) ?? "";
    if (!maxDate) {
      return NextResponse.json(
        { productCount: 0, totalValue: 0, totalQuantity: 0, totalSku: 0, error: "invalid_date" },
        { status: 200, headers: NO_CACHE }
      );
    }

    const { data, error } = await supabase
      .from(TABLE_SNAPSHOT)
      .select("product_code,quantity,pack_size,total_price,unit_cost,dest_warehouse,storage_center,sales_channel,snapshot_date")
      .eq("snapshot_date", maxDate);

    if (error) {
      log("KPI 에러", { error: error.message });
      return NextResponse.json(
        { productCount: 0, totalValue: 0, totalQuantity: 0, totalSku: 0, error: error.message },
        { status: 200, headers: NO_CACHE }
      );
    }

    const rows = (data ?? []) as SnapshotRow[];

    const codes = [...new Set(rows.map((r) => String(r.product_code ?? "").trim()).filter(Boolean))];
    const packByCode = new Map<string, number>();
    if (codes.length > 0) {
      const { data: productsData } = await supabase
        .from(TABLE_PRODUCTS)
        .select("product_code,pack_size")
        .in("product_code", codes);
      for (const p of productsData ?? []) {
        const code = String((p as { product_code: string }).product_code ?? "").trim();
        const pack = Math.max(1, toNum((p as { pack_size?: number }).pack_size));
        if (code) packByCode.set(code, pack);
      }
    }

    const agg = aggregateSnapshotRowsForDashboard(rows, new Map(), packByCode);
    const { productCount, totalValue, totalQuantity, totalSku } = agg;

    log(`KPI 완료`, { productCount, totalValue, totalQuantity, totalSku });

    return NextResponse.json(
      {
        productCount,
        totalValue,
        totalQuantity,
        totalSku,
        _meta: { elapsedMs: Date.now() - start, snapshotDate: maxDate },
      },
      { headers: NO_CACHE }
    );
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    log("KPI 에러", { error: errMsg });
    return NextResponse.json(
      { productCount: 0, totalValue: 0, totalQuantity: 0, totalSku: 0, error: errMsg },
      { status: 200, headers: NO_CACHE }
    );
  }
}
