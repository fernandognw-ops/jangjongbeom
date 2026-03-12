/**
 * KPI API - inventory_stock_snapshot 단일 테이블만 사용
 * - 총 재고 금액: SUM(total_price)
 * - 총 재고 수량(EA): SUM(quantity)
 * - 품목 수: row count
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const TABLE_SNAPSHOT = "inventory_stock_snapshot";

function toNum(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function GET() {
  const start = Date.now();
  const log = (msg: string, extra?: Record<string, unknown>) => {
    console.log(`[api/inventory/kpi] ${msg} (${Date.now() - start}ms)`, extra ?? "");
  };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return NextResponse.json(
      { productCount: 0, totalValue: 0, totalQuantity: 0, error: "supabase_not_configured" },
      { status: 200 }
    );
  }

  const supabase = createClient(url, key);

  try {
    const { data, error } = await supabase
      .from(TABLE_SNAPSHOT)
      .select("product_code,quantity,pack_size,total_price,unit_cost,dest_warehouse")
      .limit(10000);

    if (error) {
      log("KPI 에러", { error: error.message });
      return NextResponse.json(
        { productCount: 0, totalValue: 0, totalQuantity: 0, error: error.message },
        { status: 200 }
      );
    }

    const rows = (data ?? []) as Array<{ product_code?: string; quantity?: unknown; total_price?: unknown; unit_cost?: unknown; dest_warehouse?: string }>;
    const seen = new Set<string>();
    let totalValue = 0;
    let totalQuantity = 0;
    for (const r of rows) {
      const key = `${String(r.product_code ?? "").trim()}|${String(r.dest_warehouse ?? "").trim()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let price = toNum(r.total_price);
      if (price <= 0 && toNum(r.quantity) > 0) price = toNum(r.quantity) * toNum(r.unit_cost);
      totalValue += price;
      totalQuantity += toNum(r.quantity);
    }
    totalValue = Math.round(totalValue);
    const productCount = new Set(rows.map((r) => String(r.product_code ?? "").trim()).filter(Boolean)).size;

    log(`KPI 완료`, { productCount, totalValue, totalQuantity });

    return NextResponse.json({
      productCount,
      totalValue,
      totalQuantity,
      _meta: { elapsedMs: Date.now() - start },
    });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    log("KPI 에러", { error: errMsg });
    return NextResponse.json(
      { productCount: 0, totalValue: 0, totalQuantity: 0, error: errMsg },
      { status: 200 }
    );
  }
}
