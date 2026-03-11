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
      .select("product_code,quantity,pack_size,total_price")
      .limit(10000);

    if (error) {
      log("KPI 에러", { error: error.message });
      return NextResponse.json(
        { productCount: 0, totalValue: 0, totalQuantity: 0, error: error.message },
        { status: 200 }
      );
    }

    const rows = (data ?? []) as Array<{ quantity?: unknown; total_price?: unknown }>;
    const totalValue = Math.round(
      rows.reduce((s, r) => s + toNum(r.total_price), 0)
    );
    const totalQuantity = rows.reduce((s, r) => s + toNum(r.quantity), 0);
    const productCount = rows.length;

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
