/**
 * 수요 예측 분석 API
 * GET /api/demand-forecast
 *
 * inventory_outbound 기반 일자별 그룹화, 30일 평균 판매량, 권장 발주량 반환
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  computeStockByProduct,
  getStockFromSnapshot,
  computeAvg30DayOutboundByProduct,
  computeRecommendedOrderByProduct,
  computeSafetyStockByProduct,
  getDailyOutboundByProduct,
  DEFAULT_LEAD_TIME_DAYS,
} from "@/lib/inventoryApi";
import type { InventoryProduct, InventoryOutbound, StockSnapshotRow } from "@/lib/inventoryApi";

const TABLE_PRODUCTS = "inventory_products";
const TABLE_OUTBOUND = "inventory_outbound";
const TABLE_STOCK_SNAPSHOT = "inventory_stock_snapshot";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 503 }
    );
  }

  const supabase = createClient(url, key);

  try {
    const [productsRes, outboundRes, snapshotRes] = await Promise.all([
      supabase.from(TABLE_PRODUCTS).select("*").order("product_code"),
      supabase.from(TABLE_OUTBOUND).select("*").order("outbound_date", { ascending: false }),
      supabase.from(TABLE_STOCK_SNAPSHOT).select("product_code,quantity,unit_cost,snapshot_date"),
    ]);

    if (productsRes.error || outboundRes.error) {
      return NextResponse.json(
        { error: productsRes.error?.message ?? outboundRes.error?.message },
        { status: 500 }
      );
    }

    const products = (productsRes.data ?? []) as InventoryProduct[];
    const outbound = (outboundRes.data ?? []) as InventoryOutbound[];
    const snapshot = (snapshotRes.data ?? []) as StockSnapshotRow[];

    const snapshotStock = getStockFromSnapshot(snapshot.length > 0 ? snapshot : null);
    const computedStock = computeStockByProduct(products, [], outbound);
    const stockByProduct =
      Object.keys(snapshotStock).length > 0
        ? { ...computedStock, ...snapshotStock }
        : computedStock;

    const dailyByProduct = getDailyOutboundByProduct(outbound, 30);
    const avg30DayOutbound = computeAvg30DayOutboundByProduct(outbound);
    const safetyStockByProduct = computeSafetyStockByProduct(outbound, products);
    const recommendedOrder = computeRecommendedOrderByProduct(
      stockByProduct,
      avg30DayOutbound,
      products,
      safetyStockByProduct
    );

    const items = products.map((p) => ({
      product_code: p.product_code,
      product_name: p.product_name,
      group_name: p.group_name,
      lead_time_days: p.lead_time_days ?? DEFAULT_LEAD_TIME_DAYS,
      current_stock: Math.max(0, stockByProduct[p.product_code] ?? 0),
      avg_30day_outbound: Math.round((avg30DayOutbound[p.product_code] ?? 0) * 100) / 100,
      daily_outbound: dailyByProduct[p.product_code] ?? {},
      recommended_order: recommendedOrder[p.product_code] ?? 0,
    }));

    return NextResponse.json({
      summary: {
        total_products: products.length,
        products_with_recommended_order: Object.keys(recommendedOrder).length,
      },
      items: items.filter((i) => i.avg_30day_outbound > 0 || i.recommended_order > 0),
    });
  } catch (e) {
    console.error("[demand-forecast] error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
