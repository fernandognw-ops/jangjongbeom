/**
 * Supabase inventory_* 테이블 API
 * inventory_products, inventory_inbound, inventory_outbound
 */

import { createClient } from "@supabase/supabase-js";
import type { ItemId, StockMap, Transaction } from "./types";
import { mapGroupToItemId } from "./unifiedImport";

const TABLE_PRODUCTS = "inventory_products";
const TABLE_INBOUND = "inventory_inbound";
const TABLE_OUTBOUND = "inventory_outbound";

export interface InventoryProduct {
  id: string;
  code: string;
  name: string;
  group_name: string;
  sub_group: string;
  spec: string;
  unit_cost: number;
  pack_size: number;
  sales_channel: "coupang" | "general";
}

export interface InventoryInbound {
  id: string;
  product_code: string;
  quantity: number;
  sales_channel: string;
  inbound_date: string;
  source_warehouse: string | null;
  dest_warehouse: string | null;
  note: string | null;
}

export interface InventoryOutbound {
  id: string;
  product_code: string;
  quantity: number;
  sales_channel: string;
  outbound_date: string;
  source_warehouse: string | null;
  dest_warehouse: string | null;
  note: string | null;
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function fetchInventoryData(): Promise<{
  products: InventoryProduct[];
  inbound: InventoryInbound[];
  outbound: InventoryOutbound[];
} | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  try {
    const [productsRes, inboundRes, outboundRes] = await Promise.all([
      supabase.from(TABLE_PRODUCTS).select("*").order("code"),
      supabase.from(TABLE_INBOUND).select("*").order("inbound_date", { ascending: false }),
      supabase.from(TABLE_OUTBOUND).select("*").order("outbound_date", { ascending: false }),
    ]);

    if (productsRes.error || inboundRes.error || outboundRes.error) {
      console.error("Supabase fetch error:", productsRes.error || inboundRes.error || outboundRes.error);
      return null;
    }

    return {
      products: (productsRes.data ?? []) as InventoryProduct[],
      inbound: (inboundRes.data ?? []) as InventoryInbound[],
      outbound: (outboundRes.data ?? []) as InventoryOutbound[],
    };
  } catch (e) {
    console.error("fetchInventoryData error:", e);
    return null;
  }
}

/** 제품별 재고 = sum(입고) - sum(출고) */
export function computeStockByProduct(
  products: InventoryProduct[],
  inbound: InventoryInbound[],
  outbound: InventoryOutbound[]
): Record<string, number> {
  const stock: Record<string, number> = {};
  const codeToGroup = new Map(products.map((p) => [p.code, p.group_name]));

  for (const p of products) {
    stock[p.code] = 0;
  }

  for (const i of inbound) {
    stock[i.product_code] = (stock[i.product_code] ?? 0) + i.quantity;
  }
  for (const o of outbound) {
    stock[o.product_code] = (stock[o.product_code] ?? 0) - o.quantity;
  }

  return stock;
}

/** 품목별(카테고리) 재고 집계 */
export function computeStockByCategory(
  stockByProduct: Record<string, number>,
  products: InventoryProduct[]
): StockMap {
  const stock: StockMap = {
    mask: 0,
    capsule: 0,
    fabric: 0,
    liquid: 0,
    living: 0,
  };
  for (const p of products) {
    const qty = stockByProduct[p.code] ?? 0;
    const itemId = mapGroupToItemId(p.group_name) as ItemId;
    stock[itemId] = (stock[itemId] ?? 0) + qty;
  }
  return stock;
}

/** 총 재고 금액 = sum(제품별 재고 × unit_cost) */
export function computeTotalValue(
  stockByProduct: Record<string, number>,
  products: InventoryProduct[]
): number {
  let total = 0;
  for (const p of products) {
    const qty = stockByProduct[p.code] ?? 0;
    const cost = p.unit_cost ?? 0;
    total += qty * cost;
  }
  return Math.round(total);
}

/** inbound + outbound → Transaction[] (컴포넌트 호환) */
export function toTransactions(
  inbound: InventoryInbound[],
  outbound: InventoryOutbound[],
  products: InventoryProduct[]
): Transaction[] {
  const codeToGroup = new Map(products.map((p) => [p.code, p.group_name]));
  const codeToName = new Map(products.map((p) => [p.code, p.name]));
  const txs: Transaction[] = [];

  for (const i of inbound) {
    const group = codeToGroup.get(i.product_code) ?? "기타";
    txs.push({
      id: i.id,
      date: i.inbound_date.slice(0, 10),
      itemId: mapGroupToItemId(group) as ItemId,
      type: "in",
      quantity: i.quantity,
      person: i.source_warehouse || i.dest_warehouse || "-",
      note: i.note || "",
      createdAt: 0,
      productCode: i.product_code,
      salesChannel: i.sales_channel === "coupang" ? "coupang" : "general",
    });
  }
  for (const o of outbound) {
    const group = codeToGroup.get(o.product_code) ?? "기타";
    txs.push({
      id: o.id,
      date: o.outbound_date.slice(0, 10),
      itemId: mapGroupToItemId(group) as ItemId,
      type: "out",
      quantity: o.quantity,
      person: o.source_warehouse || o.dest_warehouse || "-",
      note: o.note || "",
      createdAt: 0,
      productCode: o.product_code,
      salesChannel: o.sales_channel === "coupang" ? "coupang" : "general",
    });
  }

  return txs.sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0));
}

/** 채널별 제품 재고 = sum(입고) - sum(출고) per channel */
export function computeStockByProductByChannel(
  products: InventoryProduct[],
  inbound: InventoryInbound[],
  outbound: InventoryOutbound[]
): { coupang: Record<string, number>; general: Record<string, number> } {
  const coupang: Record<string, number> = {};
  const general: Record<string, number> = {};
  for (const p of products) {
    coupang[p.code] = 0;
    general[p.code] = 0;
  }
  for (const i of inbound) {
    const t = i.sales_channel === "coupang" ? coupang : general;
    t[i.product_code] = (t[i.product_code] ?? 0) + i.quantity;
  }
  for (const o of outbound) {
    const t = o.sales_channel === "coupang" ? coupang : general;
    t[o.product_code] = (t[o.product_code] ?? 0) - o.quantity;
  }
  return { coupang, general };
}

/** 오늘 입고/출고 건수 */
export function getTodayInOutCount(
  inbound: InventoryInbound[],
  outbound: InventoryOutbound[]
): { inbound: number; outbound: number } {
  const today = new Date().toISOString().slice(0, 10);
  let inCount = 0;
  let outCount = 0;
  for (const i of inbound) {
    if (i.inbound_date?.slice(0, 10) === today) inCount++;
  }
  for (const o of outbound) {
    if (o.outbound_date?.slice(0, 10) === today) outCount++;
  }
  return { inbound: inCount, outbound: outCount };
}

/** 최근 2주 출고 기준 제품별 안전재고 */
export function computeSafetyStockByProduct(
  outbound: InventoryOutbound[],
  products: InventoryProduct[]
): Record<string, number> {
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 14);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const outByProduct: Record<string, number> = {};
  for (const o of outbound) {
    if (o.outbound_date < cutoffStr) continue;
    outByProduct[o.product_code] = (outByProduct[o.product_code] ?? 0) + o.quantity;
  }
  return outByProduct;
}

/** 품목별 입고/출고 합계 (BaseStockAndDailyStock용) */
export function computeInOutByItem(transactions: Transaction[]): {
  inByItem: Record<ItemId, number>;
  outByItem: Record<ItemId, number>;
} {
  const inBy: Record<ItemId, number> = {
    mask: 0,
    capsule: 0,
    fabric: 0,
    liquid: 0,
    living: 0,
  };
  const outBy: Record<ItemId, number> = {
    mask: 0,
    capsule: 0,
    fabric: 0,
    liquid: 0,
    living: 0,
  };
  for (const tx of transactions) {
    if (tx.type === "in") {
      inBy[tx.itemId] = (inBy[tx.itemId] ?? 0) + tx.quantity;
    } else {
      outBy[tx.itemId] = (outBy[tx.itemId] ?? 0) + tx.quantity;
    }
  }
  return { inByItem: inBy, outByItem: outBy };
}
