/**
 * inventory_stock_snapshot 행 집계 — quick / kpi 공통
 * - 모든 DB 행을 합산 (동일 PK 중복 행이 있어도 SUM(quantity)와 일치)
 */
import { normalizeDestWarehouse, WAREHOUSE_COUPANG } from "@/lib/inventoryChannels";

export type SnapshotRow = {
  product_code?: string;
  product_name?: string;
  quantity?: unknown;
  pack_size?: unknown;
  total_price?: unknown;
  unit_cost?: unknown;
  dest_warehouse?: string;
  category?: string;
  snapshot_date?: string;
};

function toNum(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function effectivePack(
  code: string,
  rowPack: unknown,
  packByCode?: Map<string, number>
): number {
  const n = toNum(rowPack);
  if (n > 0) return Math.max(1, n);
  const fb = code ? packByCode?.get(code) : undefined;
  return Math.max(1, toNum(fb ?? 0) || 1);
}

/**
 * totalQuantity = 모든 행 quantity 합
 * totalValue = 행마다 total_price, 0 이하면 quantity*unit_cost
 * totalSku = 품목별 floor(합계 quantity / 대표 pack) 합
 */
export function aggregateSnapshotRowsForDashboard(
  rows: SnapshotRow[],
  productFallback: Map<string, { product_name: string; category: string }>,
  packByCode?: Map<string, number>
) {
  const stockByChannel = { coupang: {} as Record<string, number>, general: {} as Record<string, number> };
  const stockByWarehouse: Record<string, number> = {};
  const merged: Record<string, { qty: number; price: number; pack: number; name: string; category: string }> = {};

  for (const r of rows) {
    const code = String(r.product_code ?? "").trim();
    if (!code) continue;
    const wh = normalizeDestWarehouse(r.dest_warehouse);
    const qty = toNum(r.quantity);
    const pack = effectivePack(code, r.pack_size, packByCode);
    let price = toNum(r.total_price);
    if (price <= 0 && qty > 0) price = qty * toNum(r.unit_cost);

    stockByWarehouse[wh] = (stockByWarehouse[wh] ?? 0) + qty;
    if (wh === WAREHOUSE_COUPANG) {
      stockByChannel.coupang[code] = (stockByChannel.coupang[code] ?? 0) + qty;
    } else {
      stockByChannel.general[code] = (stockByChannel.general[code] ?? 0) + qty;
    }

    const fallback = productFallback.get(code);
    const name = String(r.product_name ?? "").trim() || fallback?.product_name || code;
    const category = String(r.category ?? "").trim() || fallback?.category || "기타";

    if (!merged[code]) {
      merged[code] = { qty: 0, price: 0, pack, name, category };
    } else {
      merged[code].pack = Math.max(merged[code].pack, pack);
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

  return {
    items,
    totalValue: Math.round(totalValue),
    totalQuantity,
    totalSku,
    productCount: items.length,
    stockByChannel,
    stockByWarehouse,
  };
}
