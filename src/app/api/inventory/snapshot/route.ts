/**
 * 단일 출처 API - inventory_stock_snapshot + inventory_outbound
 * GET /api/inventory/snapshot
 *
 * - product_code, quantity, pack_size, total_price
 * - dailyVelocityByProduct: 최근 30일 출고 합산 / 30 (일일 평균 판매량)
 */
import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function toNum(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** sales_channel이 쿠팡(coupang)인지 판별. DB에 'coupang' 또는 '쿠팡' 저장 가능 */
function isCoupangChannel(ch: string | null | undefined): boolean {
  const s = String(ch ?? "").trim().toLowerCase();
  return s === "coupang" || s === "쿠팡" || s.includes("쿠팡");
}

/** dest_warehouse(=창고명)가 쿠팡 재고인지. 테이칼튼, 테이칼튼1공장 → 쿠팡 */
function isCoupangStock(dest: string | null | undefined): boolean {
  const s = String(dest ?? "").trim().replace(/\s/g, "").toLowerCase();
  return s.includes("테이칼튼") || s === "coupang";
}

/** dest_warehouse(=창고명)가 일반 재고인지. 제이에스, 컬리 → 일반 */
function isGeneralStock(dest: string | null | undefined): boolean {
  const s = String(dest ?? "").trim();
  return s.includes("제이에스") || s.includes("컬리") || s.toLowerCase() === "general";
}

const PAGE_SIZE = 1000;

async function fetchAllOutbound(
  supabase: SupabaseClient,
  dateFrom: string
): Promise<{ product_code: string; quantity: number; sales_channel?: string }[]> {
  const all: { product_code: string; quantity: number; sales_channel?: string }[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("inventory_outbound")
      .select("product_code,quantity,sales_channel")
      .gte("outbound_date", dateFrom)
      .order("outbound_date", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) break;
    const rows = (data ?? []) as { product_code: string; quantity: unknown; sales_channel?: string }[];
    all.push(...rows.map((r) => ({
      product_code: String(r.product_code ?? "").trim(),
      quantity: toNum(r.quantity),
      sales_channel: r.sales_channel,
    })));
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return NextResponse.json(
      { items: [], totalValue: 0, totalQuantity: 0, totalSku: 0, dailyVelocityByProduct: {}, error: "supabase_not_configured" },
      { status: 200 }
    );
  }

  const supabase = createClient(url, key);

  try {
    const date30Ago = new Date();
    date30Ago.setDate(date30Ago.getDate() - 30);
    const dateFrom = date30Ago.toISOString().slice(0, 10);

    const [snapshotRes, outboundRows] = await Promise.all([
      supabase
        .from("inventory_stock_snapshot")
        .select("product_code,product_name,quantity,pack_size,total_price")
        .order("product_code")
        .limit(10000),
      fetchAllOutbound(supabase, dateFrom),
    ]);

    const { data: snapshotData, error } = snapshotRes;
    if (error) {
      return NextResponse.json(
        { items: [], totalValue: 0, totalQuantity: 0, totalSku: 0, dailyVelocityByProduct: {}, error: error.message },
        { status: 200 }
      );
    }

    const rows = (snapshotData ?? []) as Array<{ product_code?: string; product_name?: string; quantity?: unknown; pack_size?: unknown; total_price?: unknown; dest_warehouse?: string }>;
    const stockByChannel = { coupang: {} as Record<string, number>, general: {} as Record<string, number> };
    const mergedByProduct: Record<string, { qty: number; price: number; pack: number; name: string }> = {};

    for (const r of rows) {
      const qty = toNum(r.quantity);
      const pack = Math.max(1, toNum(r.pack_size));
      const price = toNum(r.total_price);
      const code = String(r.product_code ?? "").trim();
      if (isCoupangStock(r.dest_warehouse)) {
        stockByChannel.coupang[code] = (stockByChannel.coupang[code] ?? 0) + qty;
      } else {
        stockByChannel.general[code] = (stockByChannel.general[code] ?? 0) + qty;
      }
      if (!mergedByProduct[code]) {
        mergedByProduct[code] = { qty: 0, price: 0, pack, name: String(r.product_name ?? "").trim() || code };
      }
      mergedByProduct[code].qty += qty;
      mergedByProduct[code].price += price;
    }

    let totalValue = 0;
    let totalQuantity = 0;
    let totalSku = 0;
    const items = Object.entries(mergedByProduct).map(([code, data]) => {
      const qty = data.qty;
      const pack = Math.max(1, data.pack);
      const price = data.price;
      const sku = Math.floor(qty / pack);
      totalValue += price;
      totalQuantity += qty;
      totalSku += sku;
      return {
        product_code: code,
        product_name: data.name || undefined,
        quantity: qty,
        pack_size: pack,
        total_price: price,
        sku,
      };
    });

    const sumByProduct: Record<string, number> = {};
    const sumByProductCoupang: Record<string, number> = {};
    const sumByProductGeneral: Record<string, number> = {};
    for (const o of outboundRows) {
      const code = o.product_code;
      if (!code) continue;
      const qty = o.quantity;
      sumByProduct[code] = (sumByProduct[code] ?? 0) + qty;
      if (isCoupangChannel(o.sales_channel)) sumByProductCoupang[code] = (sumByProductCoupang[code] ?? 0) + qty;
      else sumByProductGeneral[code] = (sumByProductGeneral[code] ?? 0) + qty;
    }
    const dailyVelocityByProduct: Record<string, number> = {};
    const dailyVelocityByProductCoupang: Record<string, number> = {};
    const dailyVelocityByProductGeneral: Record<string, number> = {};
    for (const [code, sum] of Object.entries(sumByProduct)) {
      dailyVelocityByProduct[code] = sum / 30;
    }
    for (const [code, sum] of Object.entries(sumByProductCoupang)) {
      dailyVelocityByProductCoupang[code] = sum / 30;
    }
    for (const [code, sum] of Object.entries(sumByProductGeneral)) {
      dailyVelocityByProductGeneral[code] = sum / 30;
    }

    const outboundByChannel = {
      coupang: Object.values(sumByProductCoupang).reduce((a, b) => a + b, 0),
      general: Object.values(sumByProductGeneral).reduce((a, b) => a + b, 0),
    };

    const uniqueProductCount = new Set(items.map((i) => i.product_code)).size;
    return NextResponse.json({
      items,
      totalValue: Math.round(totalValue),
      totalQuantity,
      totalSku,
      productCount: uniqueProductCount,
      dailyVelocityByProduct,
      dailyVelocityByProductCoupang,
      dailyVelocityByProductGeneral,
      outboundByChannel,
      stockByChannel,
    });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { items: [], totalValue: 0, totalQuantity: 0, totalSku: 0, dailyVelocityByProduct: {}, error: err },
      { status: 200 }
    );
  }
}
