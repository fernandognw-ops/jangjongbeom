/**
 * 초고속 로딩 API - inventory_stock_snapshot 단일 테이블만
 * GET /api/inventory/quick
 * - snapshot API보다 단순, products/outbound 조회 없음
 */
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function toNum(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** dest_warehouse(창고명)가 쿠팡 재고인지. 테이칼튼, 테이칼튼1공장 → 쿠팡 */
function isCoupangStock(dest: string | null | undefined): boolean {
  const s = String(dest ?? "").trim().replace(/\s/g, "").toLowerCase();
  return s.includes("테이칼튼") || s === "coupang";
}

/** dest_warehouse(창고명)가 일반 재고인지. 제이에스, 컬리 → 일반 */
function isGeneralStock(dest: string | null | undefined): boolean {
  const s = String(dest ?? "").trim();
  return s.includes("제이에스") || s.includes("컬리") || s.toLowerCase() === "general";
}

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return NextResponse.json(
      { items: [], totalValue: 0, totalQuantity: 0, totalSku: 0, productCount: 0, error: "supabase_not_configured" },
      { status: 200 }
    );
  }

  const supabase = createClient(url, key);

  try {
    const { data, error } = await supabase
      .from("inventory_stock_snapshot")
      .select("product_code,product_name,quantity,pack_size,total_price,unit_cost,dest_warehouse,category,snapshot_date")
      .order("snapshot_date", { ascending: false })
      .limit(10000);

    if (error) {
      return NextResponse.json(
        { items: [], totalValue: 0, totalQuantity: 0, totalSku: 0, productCount: 0, error: error.message },
        { status: 200 }
      );
    }

    const allRows = (data ?? []) as Array<{
      product_code?: string;
      product_name?: string;
      quantity?: unknown;
      pack_size?: unknown;
      total_price?: unknown;
      unit_cost?: unknown;
      dest_warehouse?: string;
      category?: string;
      snapshot_date?: string;
    }>;

    const maxDate = allRows.length > 0
      ? allRows.reduce((max, r) => {
          const d = (r.snapshot_date ?? "").slice(0, 10);
          return d > max ? d : max;
        }, "1970-01-01")
      : "";
    const rows = maxDate ? allRows.filter((r) => (r.snapshot_date ?? "").slice(0, 10) === maxDate) : allRows;

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

    const seen = new Set<string>();
    const stockByChannel = { coupang: {} as Record<string, number>, general: {} as Record<string, number> };
    const stockByWarehouse: Record<string, number> = {};
    const merged: Record<string, { qty: number; price: number; pack: number; name: string; category: string }> = {};

    for (const r of rows) {
      const code = String(r.product_code ?? "").trim();
      const wh = String(r.dest_warehouse ?? "").trim() || "제이에스";
      const key = `${code}|${wh}`;
      if (!code || seen.has(key)) continue;
      seen.add(key);

      const qty = toNum(r.quantity);
      const pack = Math.max(1, toNum(r.pack_size));
      let price = toNum(r.total_price);
      if (price <= 0 && qty > 0) price = qty * toNum(r.unit_cost);

      stockByWarehouse[wh] = (stockByWarehouse[wh] ?? 0) + qty;

      if (isCoupangStock(r.dest_warehouse)) {
        stockByChannel.coupang[code] = (stockByChannel.coupang[code] ?? 0) + qty;
      } else {
        stockByChannel.general[code] = (stockByChannel.general[code] ?? 0) + qty;
      }

      const fallback = productFallback.get(code);
      const name = String(r.product_name ?? "").trim() || fallback?.product_name || code;
      const category = String(r.category ?? "").trim() || fallback?.category || "기타";

      if (!merged[code]) {
        merged[code] = {
          qty: 0,
          price: 0,
          pack,
          name,
          category,
        };
      }
      merged[code].qty += qty;
      merged[code].price += price;
    }

    let totalValue = 0;
    let totalQuantity = 0;
    let totalSku = 0;
    const items = Object.entries(merged).map(([code, d]) => {
      const pack = Math.max(1, d.pack);
      const sku = Math.floor(d.qty / pack);
      totalValue += d.price;
      totalQuantity += d.qty;
      totalSku += sku;
      return {
        product_code: code,
        product_name: d.name || undefined,
        quantity: d.qty,
        pack_size: pack,
        total_price: d.price,
        sku,
        category: d.category,
      };
    });

    return NextResponse.json(
      {
        items,
        totalValue: Math.round(totalValue),
        totalQuantity,
        totalSku,
        productCount: items.length,
        stockByChannel,
        stockByWarehouse,
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { items: [], totalValue: 0, totalQuantity: 0, totalSku: 0, productCount: 0, error: err },
      { status: 200 }
    );
  }
}
