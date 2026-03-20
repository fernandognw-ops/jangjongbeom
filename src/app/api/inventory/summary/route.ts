/**
 * 재고 요약 API (집계 우선 - Raw 데이터 미반환)
 * GET /api/inventory/summary
 *
 * DB에서 SUM/GROUP BY로 집계 후 결과만 반환.
 * inbound/outbound Raw 50k건 대신 집계값만 전송 (데이터 1/100 수준)
 */
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  getStockFromSnapshot,
  computeTotalValueFromSnapshot,
  computeRecommendedOrderByProduct,
  normalizeCode,
} from "@/lib/inventoryApi";
import type { InventoryProduct, StockSnapshotRow } from "@/lib/inventoryApi";
import { normalizeDestWarehouse } from "@/lib/inventoryChannels";

const TABLE_PRODUCTS = "inventory_products";
const TABLE_SNAPSHOT = "inventory_stock_snapshot";
const TABLE_CURRENT = "inventory_current_products";

function toNumber(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** dest_warehouse(판매채널)가 쿠팡인지. "쿠팡" 또는 legacy 테이칼튼 */
function isCoupangInbound(dest: string | null | undefined): boolean {
  const s = String(dest ?? "").trim();
  return s === "쿠팡" || s.includes("테이칼튼");
}

/** dest_warehouse(판매채널)가 일반인지. "일반" 또는 legacy 제이에스/컬리 */
function isGeneralInbound(dest: string | null | undefined): boolean {
  const s = String(dest ?? "").trim();
  return s === "일반" || s.includes("제이에스") || s.includes("컬리");
}

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
  const startMs = Date.now();

  try {
    let outboundAgg: { product_code: string; total_outbound: number; day_count: number }[] = [];
    let todayRow = { inbound_count: 0, outbound_count: 0 };

    const now = new Date();
    const thisMonthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

    const [productsRes, snapshotRes, currentRes, outboundAggRes, todayCountRes, inboundRes] =
      await Promise.all([
        supabase.from(TABLE_PRODUCTS).select("*").order("product_code"),
        supabase.from(TABLE_SNAPSHOT).select("product_code,quantity,unit_cost,snapshot_date,dest_warehouse"),
        supabase.from(TABLE_CURRENT).select("product_code"),
        supabase.rpc("get_outbound_product_agg", { p_days: 90 }),
        supabase.rpc("get_today_inout_count"),
        supabase.from("inventory_inbound").select("quantity,dest_warehouse").gte("inbound_date", thisMonthStart).limit(50000),
      ]);

    if (productsRes.error) {
      console.error("[inventory/summary] products error:", productsRes.error);
      return NextResponse.json(
        { error: productsRes.error.message, products: [] },
        { status: 200 }
      );
    }

    const products = (productsRes.data ?? []) as InventoryProduct[];
    const allSnapshotRows = (snapshotRes.data ?? []) as { product_code: string; quantity: unknown; unit_cost: unknown; snapshot_date: string; dest_warehouse?: string }[];
    // 최신 snapshot_date만 사용 (재고 자산은 가장 최신 데이터 기준)
    const maxSnapshotDate = allSnapshotRows.length > 0
      ? allSnapshotRows.reduce((max, r) => {
          const d = (r.snapshot_date ?? "").slice(0, 10);
          return d > max ? d : max;
        }, "1970-01-01")
      : "";
    const stockSnapshotRows = maxSnapshotDate
      ? allSnapshotRows.filter((r) => (r.snapshot_date ?? "").slice(0, 10) === maxSnapshotDate)
      : allSnapshotRows;
    const currentCodes =
      currentRes.data != null
        ? (currentRes.data as { product_code: string }[]).map((r) => r.product_code)
        : [];
    if (!outboundAggRes.error && Array.isArray(outboundAggRes.data)) {
      outboundAgg = outboundAggRes.data as typeof outboundAgg;
    }
    if (!todayCountRes.error && Array.isArray(todayCountRes.data) && todayCountRes.data[0]) {
      todayRow = todayCountRes.data[0] as { inbound_count: number; outbound_count: number };
    }

    let inboundByChannel = { coupang: 0, general: 0 };
    if (!inboundRes.error && Array.isArray(inboundRes.data)) {
      const rows = inboundRes.data as { quantity?: unknown; dest_warehouse?: string }[];
      for (const r of rows) {
        const qty = toNumber(r.quantity);
        if (isCoupangInbound(r.dest_warehouse)) inboundByChannel.coupang += qty;
        else inboundByChannel.general += qty;
      }
    }

    const hasSnapshot = stockSnapshotRows.length > 0;
    let stockByProduct: Record<string, number>;
    let stockByProductByChannel = { coupang: {} as Record<string, number>, general: {} as Record<string, number> };

    if (hasSnapshot) {
      const snapshotForStock = stockSnapshotRows.map((r) => ({
        product_code: r.product_code ?? "",
        quantity: Number(r.quantity) ?? 0,
        unit_cost: Number(r.unit_cost) ?? 0,
        snapshot_date: r.snapshot_date ?? "",
      }));
      stockByProduct = getStockFromSnapshot(snapshotForStock);
      for (const r of stockSnapshotRows) {
        const code = normalizeCode(r.product_code) || String(r.product_code ?? "").trim();
        const qty = toNumber(r.quantity);
        const wh = normalizeDestWarehouse(r.dest_warehouse);
        if (wh === "쿠팡") {
          stockByProductByChannel.coupang[code] = (stockByProductByChannel.coupang[code] ?? 0) + qty;
        } else {
          stockByProductByChannel.general[code] = (stockByProductByChannel.general[code] ?? 0) + qty;
        }
      }
    } else {
      const [inRes, outRes] = await Promise.all([
        supabase.from("inventory_inbound").select("product_code,quantity").limit(50000),
        supabase.from("inventory_outbound").select("product_code,quantity").limit(50000),
      ]);
      const inbound = (inRes.data ?? []) as { product_code: string; quantity: number }[];
      const outbound = (outRes.data ?? []) as { product_code: string; quantity: number }[];
      stockByProduct = {};
      for (const i of inbound) {
        const code = normalizeCode(i.product_code) || String(i.product_code).trim();
        stockByProduct[code] = (stockByProduct[code] ?? 0) + toNumber(i.quantity);
      }
      for (const o of outbound) {
        const code = normalizeCode(o.product_code) || String(o.product_code).trim();
        stockByProduct[code] = (stockByProduct[code] ?? 0) - toNumber(o.quantity);
      }
    }

    if (!hasSnapshot) {
      stockByProductByChannel = { coupang: {} as Record<string, number>, general: { ...stockByProduct } };
    }

    const outboundByCode: Record<string, { total: number; days: number }> = {};
    for (const r of outboundAgg) {
      const code = normalizeCode(r.product_code) || String(r.product_code).trim();
      outboundByCode[code] = {
        total: toNumber(r.total_outbound),
        days: Math.max(1, toNumber(r.day_count)),
      };
    }

    const safetyStockByProduct: Record<string, number> = {};
    const avgDailyOutbound: Record<string, number> = {};
    for (const p of products) {
      const code = normalizeCode(p.product_code) || p.product_code;
      const agg = outboundByCode[code] ?? outboundByCode[String(p.product_code).trim()];
      if (agg) {
        const total90 = agg.total;
        const dayCount = Math.max(1, agg.days);
        safetyStockByProduct[code] = Math.max(0, Math.ceil(total90 * 0.1));
        avgDailyOutbound[code] = total90 / dayCount;
      }
    }

    const recommendedOrderByProduct = computeRecommendedOrderByProduct(
      stockByProduct,
      avgDailyOutbound,
      products,
      safetyStockByProduct
    );

    const stockSnapshot = stockSnapshotRows.map((r) => ({
      product_code: r.product_code ?? "",
      quantity: Number(r.quantity) ?? 0,
      unit_cost: Number(r.unit_cost) ?? 0,
      snapshot_date: r.snapshot_date ?? "",
    })) as StockSnapshotRow[];

    const totalValue = hasSnapshot
      ? computeTotalValueFromSnapshot(stockSnapshot, products)
      : (() => {
          const codeToProduct = new Map(products.map((p) => [normalizeCode(p.product_code), p]));
          let sum = 0;
          for (const [code, qty] of Object.entries(stockByProduct)) {
            const p = codeToProduct.get(normalizeCode(code)) ?? codeToProduct.get(code);
            const costVal = p?.unit_cost ?? 0;
            if (costVal > 0 && costVal <= 500_000) sum += qty * costVal;
          }
          return Math.round(sum);
        })();

    const codesToUse =
      currentCodes.length > 0
        ? currentCodes
        : stockSnapshotRows.length > 0
          ? [...new Set(stockSnapshotRows.map((s) => s.product_code).filter(Boolean))]
          : products.map((p) => p.product_code);

    const productSet = new Set(codesToUse);
    const filteredProducts = products.filter(
      (p) =>
        productSet.has(p.product_code) ||
        productSet.has(normalizeCode(p.product_code) || "")
    );
    const finalProducts =
      filteredProducts.length > 0 ? filteredProducts : products;

    return NextResponse.json({
      products: finalProducts,
      stockSnapshot,
      stockByProduct,
      stockByProductByChannel,
      safetyStockByProduct,
      avg30DayOutbound: avgDailyOutbound,
      avg60DayOutbound: avgDailyOutbound,
      todayInOutCount: {
        inbound: toNumber(todayRow.inbound_count),
        outbound: toNumber(todayRow.outbound_count),
      },
      inboundByChannel,
      recommendedOrderByProduct,
      totalValue,
      _meta: { source: "aggregated", hasSnapshot, timingMs: Date.now() - startMs },
    });
  } catch (e) {
    console.error("[inventory/summary] error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error", products: [] },
      { status: 200 }
    );
  }
}
