/**
 * 단일 출처 API (Single Source of Truth)
 * GET /api/inventory/data
 *
 * - 제품: inventory_products
 * - 수량: inventory_stock_snapshot (product_code로만 매칭)
 * - 두 테이블을 product_code 기준 JOIN하여 한 번에 반환
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeCode } from "@/lib/inventoryApi";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return NextResponse.json(
      { products: [], stockByProduct: {}, totalValue: 0, error: "supabase_not_configured" },
      { status: 200 }
    );
  }

  const supabase = createClient(url, key);

  try {
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    const dateFrom = oneMonthAgo.toISOString().slice(0, 10);

    const [productsRes, snapshotRes, inboundRes, outboundRes] = await Promise.all([
      supabase.from("inventory_products").select("*").order("product_code").limit(5000),
      supabase.from("inventory_stock_snapshot").select("product_code,quantity,snapshot_date").limit(10000),
      supabase.from("inventory_inbound").select("product_code,quantity,inbound_date").gte("inbound_date", dateFrom).limit(10000),
      supabase.from("inventory_outbound").select("product_code,quantity,outbound_date,sales_channel").gte("outbound_date", dateFrom).limit(10000),
    ]);

    if (productsRes.error) {
      return NextResponse.json(
        { products: [], stockByProduct: {}, totalValue: 0, error: productsRes.error.message },
        { status: 200 }
      );
    }

    const products = (productsRes.data ?? []) as Array<{ product_code: string; unit_cost?: number; [k: string]: unknown }>;
    const inbound = inboundRes.data ?? [];
    const outbound = outboundRes.data ?? [];
    const snapshotRows = (snapshotRes.data ?? []) as Array<{ product_code?: unknown; quantity?: unknown; snapshot_date?: string }>;

    // 수량: inventory_stock_snapshot에서 product_code 매칭, 최신 snapshot_date 기준 1건
    const byProduct = new Map<string, { qty: number; date: string }>();
    for (const row of snapshotRows) {
      const code = normalizeCode(row.product_code) || String(row.product_code ?? "").trim();
      const qty = Number(row.quantity) || 0;
      const date = (row.snapshot_date ?? "").slice(0, 10);
      if (!code) continue;
      const ex = byProduct.get(code);
      if (!ex || date >= ex.date) byProduct.set(code, { qty, date });
    }
    const stockByProduct: Record<string, number> = {};
    for (const [code, v] of byProduct) {
      stockByProduct[code] = v.qty;
    }

    // totalValue = sum(수량 × unit_cost), product_code로 매칭
    let totalValue = 0;
    const codeToCost = new Map<string, number>();
    for (const p of products) {
      const c = normalizeCode(p.product_code) || String(p.product_code ?? "").trim();
      const cost = Number(p.unit_cost) || 0;
      if (c && cost > 0) codeToCost.set(c, cost);
    }
    for (const [code, qty] of Object.entries(stockByProduct)) {
      const cost = codeToCost.get(code) ?? 0;
      totalValue += qty * cost;
    }
    totalValue = Math.round(totalValue);

    return NextResponse.json({
      products,
      stockByProduct,
      totalValue,
      productCount: products.length,
      inbound,
      outbound,
    });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { products: [], stockByProduct: {}, totalValue: 0, inbound: [], outbound: [], error: err },
      { status: 200 }
    );
  }
}
