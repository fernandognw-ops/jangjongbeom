/**
 * 단일 출처 API - inventory_stock_snapshot + inventory_outbound
 * GET /api/inventory/snapshot
 *
 * - product_code, quantity, pack_size, total_price
 * - dailyVelocityByProduct: 최근 30일 출고 합산 / 30 (일일 평균 판매량)
 */
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { normalizeCode, normalizeCategory } from "@/lib/inventoryApi";
import { normalizeDestWarehouse } from "@/lib/inventoryChannels";

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

export async function GET(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return NextResponse.json(
      { items: [], totalValue: 0, totalQuantity: 0, totalSku: 0, dailyVelocityByProduct: {}, error: "supabase_not_configured" },
      { status: 200 }
    );
  }

  const { searchParams } = new URL(request.url);
  const lite = searchParams.get("lite") === "1";

  const supabase = createClient(url, key);

  try {
    const date30Ago = new Date();
    date30Ago.setDate(date30Ago.getDate() - 30);
    const dateFrom = date30Ago.toISOString().slice(0, 10);

    const [maxDateRes, productsRes, outboundRows] = await Promise.all([
      supabase
        .from("inventory_stock_snapshot")
        .select("snapshot_date")
        .order("snapshot_date", { ascending: false })
        .limit(1),
      supabase.from("inventory_products").select("product_code,category").order("product_code").limit(10000),
      lite ? Promise.resolve([] as { product_code: string; quantity: number; sales_channel?: string }[]) : fetchAllOutbound(supabase, dateFrom),
    ]);

    const maxDate = (maxDateRes?.data?.[0] as { snapshot_date?: string })?.snapshot_date?.slice(0, 10) ?? "";
    if (!maxDate) {
      return NextResponse.json(
        { items: [], totalValue: 0, totalQuantity: 0, totalSku: 0, dailyVelocityByProduct: {}, stockByChannel: { coupang: {}, general: {} }, stockByWarehouse: {}, error: "no_snapshot" },
        { status: 200 }
      );
    }

    const { data: snapshotData, error } = await supabase
      .from("inventory_stock_snapshot")
      .select("product_code,product_name,quantity,pack_size,total_price,unit_cost,dest_warehouse,category,snapshot_date")
      .eq("snapshot_date", maxDate)
      .order("product_code");

    if (error) {
      return NextResponse.json(
        { items: [], totalValue: 0, totalQuantity: 0, totalSku: 0, dailyVelocityByProduct: {}, error: error.message },
        { status: 200 }
      );
    }

    const rows = (snapshotData ?? []) as Array<{ product_code?: string; product_name?: string; quantity?: unknown; pack_size?: unknown; total_price?: unknown; unit_cost?: unknown; dest_warehouse?: string; category?: string; snapshot_date?: string }>;
    const productsData = (productsRes?.data ?? []) as Array<{ product_code?: string; group_name?: string; category?: string }>;
    const codeToCategory = new Map<string, string>();
    for (const p of productsData) {
      const rawCode = String(p.product_code ?? "").trim();
      const code = normalizeCode(p.product_code) || rawCode;
      if (!code) continue;
      const raw = String(p.category ?? p.group_name ?? "").trim();
      if (/^\d{10,}$/.test(raw)) continue;
      const cat = normalizeCategory(raw) || (raw && raw !== "기타" && raw !== "전체" ? raw : "");
      if (!cat) continue;
      codeToCategory.set(code, cat);
      codeToCategory.set(rawCode, cat);
    }
    const stockByChannel = { coupang: {} as Record<string, number>, general: {} as Record<string, number> };
    const stockByWarehouse: Record<string, number> = {};
    const mergedByProduct: Record<string, { qty: number; price: number; pack: number; name: string; category: string }> = {};

    // 모든 스냅샷 행 합산 (quick API와 동일 — 중복 행도 DB SUM과 일치)
    for (const r of rows) {
      const code = String(r.product_code ?? "").trim();
      if (!code) continue;
      const wh = normalizeDestWarehouse(r.dest_warehouse);
      const qty = toNum(r.quantity);
      const pack = Math.max(1, toNum(r.pack_size));
      let price = toNum(r.total_price);
      if (price <= 0 && qty > 0) price = qty * toNum(r.unit_cost);
      const cat = String(r.category ?? "").trim();

      stockByWarehouse[wh] = (stockByWarehouse[wh] ?? 0) + qty;

      if (wh === "쿠팡") {
        stockByChannel.coupang[code] = (stockByChannel.coupang[code] ?? 0) + qty;
      } else {
        stockByChannel.general[code] = (stockByChannel.general[code] ?? 0) + qty;
      }
      const validCat = cat && !/^\d{10,}$/.test(cat) && cat !== "기타" && cat !== "전체";
      if (!mergedByProduct[code]) {
        mergedByProduct[code] = { qty: 0, price: 0, pack, name: String(r.product_name ?? "").trim() || code, category: validCat ? cat : "" };
      } else {
        mergedByProduct[code].pack = Math.max(mergedByProduct[code].pack, pack);
        if (validCat) mergedByProduct[code].category = cat;
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
      const normCode = normalizeCode(code);
      const fromSnapshot = (data.category && data.category !== "기타" && data.category !== "전체" && !/^\d{10,}$/.test(data.category)) ? data.category : "";
      const fromProducts = codeToCategory.get(code) ?? codeToCategory.get(normCode) ?? codeToCategory.get(String(code).trim()) ?? "";
      let rawCat = fromSnapshot || fromProducts;
      if (/^\d{10,}$/.test(String(rawCat ?? "").trim())) rawCat = "";
      const cat = normalizeCategory(rawCat) || (rawCat && rawCat !== "기타" && rawCat !== "전체" ? rawCat : "");
      return {
        product_code: code,
        product_name: data.name || undefined,
        quantity: qty,
        pack_size: pack,
        total_price: price,
        sku,
        category: cat || "생활용품",
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
    return NextResponse.json(
      {
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
      stockByWarehouse,
    },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0", "Pragma": "no-cache" } }
    );
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { items: [], totalValue: 0, totalQuantity: 0, totalSku: 0, dailyVelocityByProduct: {}, error: err },
      { status: 200 }
    );
  }
}
