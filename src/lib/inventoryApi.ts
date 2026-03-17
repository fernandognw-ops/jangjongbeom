/**
 * Supabase inventory API
 * 데이터 소스: inventory_current_products + inventory_stock_snapshot(재고·금액)
 * 품목구분(category): inventory_products.category 또는 group_name → 없으면 inventory_stock_snapshot.category → 없으면 기타
 */

import { createClient } from "@supabase/supabase-js";
import type { ItemId, StockMap, Transaction } from "./types";
import { mapGroupToItemId } from "./unifiedImport";

const TABLE_PRODUCTS = "inventory_products";
const TABLE_INBOUND = "inventory_inbound";
const TABLE_OUTBOUND = "inventory_outbound";
const TABLE_STOCK_SNAPSHOT = "inventory_stock_snapshot";
const TABLE_CURRENT_PRODUCTS = "inventory_current_products";

export const DEFAULT_LEAD_TIME_DAYS = 7;
const MAX_UNIT_COST_KRW = 500_000;

function toNumber(val: unknown): number {
  if (val == null) return 0;
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

export function normalizeCode(c: unknown): string {
  if (c == null) return "";
  const s = String(c).trim();
  const num = parseFloat(s);
  if (Number.isFinite(num)) {
    if (num >= 1e10 || num <= -1e10) return String(Math.round(num));
    if (!Number.isInteger(num)) return String(Math.round(num));
  }
  return s;
}

/** 품목구분 → 표준 카테고리 정규화 (필터 매칭용) */
export const STANDARD_CATEGORIES = ["마스크", "캡슐세제", "섬유유연제", "액상세제", "생활용품", "캡슐사은품"] as const;
export function normalizeCategory(cat: string): string {
  const s = String(cat ?? "").trim();
  if (!s || s === "기타" || s === "전체") return "";
  if (s === "캡슐세제 사은품" || (s.includes("캡슐세제") && s.includes("사은품"))) return "캡슐사은품";
  for (const std of STANDARD_CATEGORIES) {
    if (s === std || s.includes(std) || std.includes(s)) return std;
  }
  return s;
}

export interface InventoryProduct {
  id: string;
  product_code: string;
  product_name: string;
  group_name: string;
  /** 품목구분 (마스크, 생활용품 등) - inventory_stock_snapshot.category 기준, 필터/분류용 */
  category?: string;
  sub_group: string;
  spec: string;
  unit_cost: number;
  pack_size: number;
  sales_channel: "coupang" | "general";
  is_active?: boolean; // 0311 Rawdata 기준 현재 운영 품목
  /** 발주 후 입고까지 기간(일), 기본 7일 */
  lead_time_days?: number;
}

export interface StockSnapshotRow {
  product_code: string;
  quantity: number;
  unit_cost: number;
  snapshot_date: string;
  /** 품목구분 (마스크, 생활용품, 섬유유연제, 액상세제, 캡슐세제 등) */
  category?: string | null;
  /** 재고금액 (수량×단가 합계). 재고원가(unit_cost)와 구분. 대시보드 총재고금액에 사용 */
  total_price?: number | null;
}

export interface InventoryInbound {
  id: string;
  product_code: string;
  quantity: number;
  /** 입고에는 채널 미사용 (출고만 사용) */
  sales_channel?: string;
  inbound_date: string;
  source_warehouse: string | null;
  dest_warehouse: string | null;
  note: string | null;
  /** 품목구분/품목 (Excel 업로드 시 저장) */
  category?: string | null;
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
  /** 품목구분/품목 (Excel 업로드 시 저장) */
  category?: string | null;
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export type FetchInventoryResult =
  | { ok: true; data: { products: InventoryProduct[]; inbound: InventoryInbound[]; outbound: InventoryOutbound[]; stockSnapshot: StockSnapshotRow[] } }
  | { ok: false; reason: "supabase_not_configured" | "fetch_error"; message?: string };

export async function fetchInventoryData(): Promise<FetchInventoryResult> {
  const supabase = getSupabase();
  if (!supabase) {
    console.warn("[inventory] Supabase 미설정: .env.local에 NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY 필요");
    return { ok: false, reason: "supabase_not_configured" };
  }

  try {
    let currentCodes: string[] = [];
    let stockSnapshot: StockSnapshotRow[] = [];
    const [currentRes, maxDateRes] = await Promise.all([
      supabase.from(TABLE_CURRENT_PRODUCTS).select("product_code").order("product_code").limit(10000),
      supabase.from(TABLE_STOCK_SNAPSHOT).select("snapshot_date").order("snapshot_date", { ascending: false }).limit(1),
    ]);
    currentCodes = currentRes.error ? [] : (currentRes.data ?? []).map((r: { product_code: string }) => r.product_code);
    const maxSnapDate = (maxDateRes?.data?.[0] as { snapshot_date?: string })?.snapshot_date?.slice(0, 10) ?? "";
    if (maxSnapDate) {
      const snapRes = await supabase
        .from(TABLE_STOCK_SNAPSHOT)
        .select("product_code,quantity,unit_cost,total_price,snapshot_date,category")
        .eq("snapshot_date", maxSnapDate);
      stockSnapshot = snapRes.error ? [] : ((snapRes.data ?? []) as StockSnapshotRow[]);
      if (snapRes.error) console.warn("[inventory] inventory_stock_snapshot 조회 실패:", snapRes.error.message);
    }
    if (currentRes.error) console.warn("[inventory] inventory_current_products 조회 실패:", currentRes.error.message);

    // 최근 6개월 조회 (누적 데이터: 1월·2월·3월 등)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const dateFrom = sixMonthsAgo.toISOString().slice(0, 10);
    const t0 = Date.now();
    const [productsRes, inboundRes, outboundRes] = await Promise.all([
      supabase.from(TABLE_PRODUCTS).select("*").order("product_code").limit(5000),
      supabase.from(TABLE_INBOUND).select("id,product_code,quantity,inbound_date,source_warehouse,dest_warehouse").gte("inbound_date", dateFrom).order("inbound_date", { ascending: false }).limit(50000),
      supabase.from(TABLE_OUTBOUND).select("id,product_code,quantity,sales_channel,outbound_date,source_warehouse,dest_warehouse").gte("outbound_date", dateFrom).order("outbound_date", { ascending: false }).limit(50000),
    ]);
    console.log(`[inventoryApi] products/inbound/outbound 쿼리 완료 (${Date.now() - t0}ms)`);

    if (inboundRes.error || outboundRes.error) {
      const err = inboundRes.error || outboundRes.error;
      console.error("[inventory] Supabase fetch 실패:", err);
      return { ok: false, reason: "fetch_error", message: err?.message ?? String(err) };
    }
    if (productsRes.error && currentCodes.length === 0 && stockSnapshot.length === 0) {
      console.error("[inventory] Supabase fetch 실패:", productsRes.error);
      return { ok: false, reason: "fetch_error", message: productsRes.error?.message ?? String(productsRes.error) };
    }

    const allProducts = (productsRes.error ? [] : (productsRes.data ?? [])) as (InventoryProduct & { category?: string })[];
    const codeToProduct = new Map<string, InventoryProduct>();
    for (const p of allProducts) {
      const k = normalizeCode(p.product_code);
      const k2 = String(p.product_code ?? "").trim();
      if (k && !codeToProduct.has(k)) codeToProduct.set(k, p);
      if (k2 && !codeToProduct.has(k2)) codeToProduct.set(k2, p);
    }

    /** product_code → category: rawdata(품목) 우선, snapshot은 보조 (대시보드 카테고리 기준) */
    const codeToCategoryFromSnapshot = new Map<string, string>();
    for (const row of stockSnapshot) {
      const code = normalizeCode(row.product_code) || String(row.product_code ?? "").trim();
      const cat = String((row as StockSnapshotRow & { category?: string }).category ?? "").trim();
      if (!code || !cat || cat === "기타" || cat === "전체") continue;
      codeToCategoryFromSnapshot.set(code, cat);
    }

    const inboundData = (inboundRes.data ?? []) as InventoryInbound[];
    const outboundData = (outboundRes.data ?? []) as InventoryOutbound[];
    const codesFromInOut = Array.from(
      new Set([...inboundData.map((i) => i.product_code), ...outboundData.map((o) => o.product_code)])
    );
    const products: InventoryProduct[] = [];
    const codesToUse =
      currentCodes.length > 0
        ? currentCodes
        : codesFromInOut.length > 0
          ? codesFromInOut
          : stockSnapshot.length > 0
            ? Array.from(new Set(stockSnapshot.map((s) => s.product_code)))
            : allProducts.map((p) => p.product_code);

    for (const code of codesToUse) {
      const key = normalizeCode(code);
      const p = codeToProduct.get(key) ?? codeToProduct.get(String(code ?? "").trim()) ?? codeToProduct.get(code);
      /** category: rawdata(품목) 우선 → inventory_stock_snapshot 보조 → 기타 */
      const fromProduct = p ? String((p as { category?: string }).category ?? (p as { group_name?: string }).group_name ?? "").trim() : "";
      const useProduct = fromProduct && fromProduct !== "기타" && fromProduct !== "전체";
      const fromSnapshot = codeToCategoryFromSnapshot.get(key) ?? codeToCategoryFromSnapshot.get(String(code ?? "").trim());
      const category = (useProduct ? fromProduct : null) || fromSnapshot || "기타";

      if (p) {
        (p as InventoryProduct & { is_active?: boolean }).is_active = true;
        (p as InventoryProduct).category = category;
        products.push(p);
      } else {
        const snap = stockSnapshot.find((s) => normalizeCode(s.product_code) === key || String(s.product_code).trim() === String(code).trim());
        products.push({
          id: code,
          product_code: code,
          product_name: code,
          group_name: "기타",
          category,
          sub_group: "",
          spec: "",
          unit_cost: snap?.unit_cost ?? 0,
          pack_size: 1,
          sales_channel: "general",
          is_active: true,
        });
      }
    }

    products.sort((a, b) => a.product_code.localeCompare(b.product_code));
    const finalProducts = products.length > 0 ? products : allProducts;

    for (const p of finalProducts) {
      (p as InventoryProduct & { is_active?: boolean }).is_active ??= true;
      const k = normalizeCode(p.product_code) || p.product_code;
      const fromProduct = String((p as { category?: string }).category ?? (p as { group_name?: string }).group_name ?? "").trim();
      const useProduct = fromProduct && fromProduct !== "기타" && fromProduct !== "전체";
      const fromSnapshot = codeToCategoryFromSnapshot.get(k) ?? codeToCategoryFromSnapshot.get(String(p.product_code).trim());
      (p as InventoryProduct).category = (useProduct ? fromProduct : null) || fromSnapshot || "기타";
    }
    const catMap = new Map<string, number>();
    for (const p of finalProducts) {
      const c = String(p.category ?? "기타").trim();
      catMap.set(c, (catMap.get(c) ?? 0) + 1);
    }
    const catCount = Object.fromEntries([...catMap.entries()].sort((a, b) => b[1] - a[1]));
    console.log(
      `[inventoryApi] 품목 ${finalProducts.length}개, 스냅샷 ${stockSnapshot.length}건, category별:`,
      catCount
    );

    return {
      ok: true,
      data: {
        products: finalProducts,
        inbound: (inboundRes.data ?? []) as InventoryInbound[],
        outbound: (outboundRes.data ?? []) as InventoryOutbound[],
        stockSnapshot,
      },
    };
  } catch (e) {
    console.error("fetchInventoryData error:", e);
    return { ok: false, reason: "fetch_error", message: e instanceof Error ? e.message : String(e) };
  }
}

/** product_code당 최신 snapshot_date 기준 집계. total_price 합산(재고금액) 포함 */
export function getLatestSnapshotByProduct(
  snapshot: StockSnapshotRow[] | null
): { stock: Record<string, number>; cost: Record<string, number>; totalPriceByCode: Record<string, number>; cutoffDate: string } {
  const stock: Record<string, number> = {};
  const cost: Record<string, number> = {};
  const totalPriceByCode: Record<string, number> = {};
  let maxDate = "1970-01-01";
  if (!snapshot || snapshot.length === 0) {
    return { stock, cost, totalPriceByCode, cutoffDate: maxDate };
  }
  const byCode = new Map<string, { qty: number; cost: number; totalPrice: number; date: string }>();
  for (const row of snapshot) {
    const r = row as unknown as Record<string, unknown>;
    const code = normalizeCode(r.product_code ?? row.product_code) || String(r.product_code ?? row.product_code ?? "").trim();
    const date = ((r.snapshot_date ?? row.snapshot_date) ?? "").toString().slice(0, 10);
    const qty = toNumber(r.quantity ?? row.quantity);
    const c = toNumber(r.unit_cost ?? row.unit_cost);
    const tp = toNumber(r.total_price ?? (row as StockSnapshotRow).total_price);
    if (date > maxDate) maxDate = date;
    const existing = byCode.get(code);
    if (!existing) {
      byCode.set(code, { qty, cost: c, totalPrice: tp, date });
    } else {
      existing.qty += qty;
      existing.totalPrice += tp;
      if (date >= existing.date && c > 0 && c <= MAX_UNIT_COST_KRW) existing.cost = c;
    }
  }
  Array.from(byCode.entries()).forEach(([code, v]) => {
    stock[code] = v.qty;
    if (v.cost > 0 && v.cost <= MAX_UNIT_COST_KRW) cost[code] = v.cost;
    if (v.totalPrice > 0) totalPriceByCode[code] = v.totalPrice;
  });
  return { stock, cost, totalPriceByCode, cutoffDate: maxDate };
}

/** inventory_stock_snapshot.quantity 우선 사용 (메인 화면 현재고) - 하위 호환 */
export function getStockFromSnapshot(snapshot: StockSnapshotRow[] | null): Record<string, number> {
  return getLatestSnapshotByProduct(snapshot).stock;
}

/**
 * [핵심] 최신 스냅샷 + 스냅샷 이후 입출고 가감 → 최종 재고
 * 누적 합산 사용 안 함. 스냅샷이 절대 기준.
 */
export function computeStockFromSnapshotPlusDelta(
  snapshot: StockSnapshotRow[] | null,
  inbound: InventoryInbound[],
  outbound: InventoryOutbound[],
  products: InventoryProduct[]
): Record<string, number> {
  const { stock: baseStock, cutoffDate } = getLatestSnapshotByProduct(snapshot);
  const allCodes = new Set<string>();
  for (const p of products) allCodes.add(normalizeCode(p.product_code) || p.product_code);
  for (const i of inbound) allCodes.add(normalizeCode(i.product_code) || String(i.product_code).trim());
  for (const o of outbound) allCodes.add(normalizeCode(o.product_code) || String(o.product_code).trim());

  const result: Record<string, number> = {};
  Array.from(allCodes).forEach((c) => { result[c] = toNumber(baseStock[c]); });

  for (const i of inbound) {
    if ((i.inbound_date ?? "").slice(0, 10) <= cutoffDate) continue;
    const code = normalizeCode(i.product_code) || String(i.product_code).trim();
    result[code] = toNumber(result[code]) + toNumber(i.quantity);
  }
  for (const o of outbound) {
    if ((o.outbound_date ?? "").slice(0, 10) <= cutoffDate) continue;
    const code = normalizeCode(o.product_code) || String(o.product_code).trim();
    result[code] = toNumber(result[code]) - toNumber(o.quantity);
  }
  return result;
}

/** 전월 말 시점 재고 (스냅샷 + 이후~전월말 입출고) - 전월 대비 분석용 */
export function computeStockAtDate(
  snapshot: StockSnapshotRow[] | null,
  inbound: InventoryInbound[],
  outbound: InventoryOutbound[],
  products: InventoryProduct[],
  asOfDate: string
): Record<string, number> {
  const { stock: baseStock, cutoffDate } = getLatestSnapshotByProduct(snapshot);
  const allCodes = new Set<string>();
  for (const p of products) allCodes.add(normalizeCode(p.product_code) || p.product_code);
  for (const i of inbound) allCodes.add(normalizeCode(i.product_code) || String(i.product_code).trim());
  for (const o of outbound) allCodes.add(normalizeCode(o.product_code) || String(o.product_code).trim());

  const result: Record<string, number> = {};
  Array.from(allCodes).forEach((c) => { result[c] = toNumber(baseStock[c]); });

  for (const i of inbound) {
    const d = (i.inbound_date ?? "").slice(0, 10);
    if (d <= cutoffDate || d > asOfDate) continue;
    const code = normalizeCode(i.product_code) || String(i.product_code).trim();
    result[code] = toNumber(result[code]) + toNumber(i.quantity);
  }
  for (const o of outbound) {
    const d = (o.outbound_date ?? "").slice(0, 10);
    if (d <= cutoffDate || d > asOfDate) continue;
    const code = normalizeCode(o.product_code) || String(o.product_code).trim();
    result[code] = toNumber(result[code]) - toNumber(o.quantity);
  }
  return result;
}

/** 특정 일자 기준 재고 금액 (전월 대비 분석용) */
export function computeTotalValueAtDate(
  snapshot: StockSnapshotRow[] | null,
  inbound: InventoryInbound[],
  outbound: InventoryOutbound[],
  products: InventoryProduct[],
  asOfDate: string
): number {
  const stockAtDate = computeStockAtDate(snapshot, inbound, outbound, products, asOfDate);
  const { cost: snapshotCost } = getLatestSnapshotByProduct(snapshot);
  const codeToProduct = new Map(products.map((p) => [normalizeCode(p.product_code), p]));
  const costs: number[] = [];
  for (const p of products) {
    const c = toNumber(p.unit_cost);
    if (c > 0 && c <= MAX_UNIT_COST_KRW) costs.push(c);
  }
  Object.values(snapshotCost).forEach((c) => costs.push(c));
  const avgCost = costs.length > 0 ? costs.reduce((a, b) => a + b, 0) / costs.length : 0;

  let total = 0;
  for (const [code, qty] of Object.entries(stockAtDate)) {
    const p = codeToProduct.get(normalizeCode(code)) ?? codeToProduct.get(String(code).trim());
    let cost = toNumber(p?.unit_cost) ?? snapshotCost[normalizeCode(code)] ?? avgCost;
    if (cost > MAX_UNIT_COST_KRW || cost < 0) cost = avgCost;
    total += toNumber(qty) * (cost > 0 ? cost : avgCost);
  }
  return Math.round(total);
}

/** [핵심] 최종 재고 금액 = (스냅샷 + 이후 입출고) × 단가 */
export function computeTotalValueFromSnapshotPlusDelta(
  snapshot: StockSnapshotRow[] | null,
  inbound: InventoryInbound[],
  outbound: InventoryOutbound[],
  products: InventoryProduct[]
): number {
  const stockByProduct = computeStockFromSnapshotPlusDelta(snapshot, inbound, outbound, products);
  const { cost: snapshotCost } = getLatestSnapshotByProduct(snapshot);
  const codeToProduct = new Map(products.map((p) => [normalizeCode(p.product_code), p]));
  const costs: number[] = [];
  for (const p of products) {
    const c = toNumber(p.unit_cost);
    if (c > 0 && c <= MAX_UNIT_COST_KRW) costs.push(c);
  }
  Object.values(snapshotCost).forEach((c) => costs.push(c));
  const avgCost = costs.length > 0 ? costs.reduce((a, b) => a + b, 0) / costs.length : 0;

  let total = 0;
  for (const [code, qty] of Object.entries(stockByProduct)) {
    const p = codeToProduct.get(normalizeCode(code)) ?? codeToProduct.get(String(code).trim());
    let cost = toNumber(p?.unit_cost) ?? snapshotCost[normalizeCode(code)] ?? snapshotCost[code] ?? avgCost;
    if (cost > MAX_UNIT_COST_KRW || cost < 0) cost = avgCost;
    total += toNumber(qty) * (cost > 0 ? cost : avgCost);
  }
  return Math.round(total);
}

/** 스냅샷이 있으면 사용, 없으면 입출고 계산값 사용 (하위 호환) */
export function mergeStockWithSnapshot(
  computedStock: Record<string, number>,
  snapshot: StockSnapshotRow[] | null
): Record<string, number> {
  if (!snapshot || snapshot.length === 0) return computedStock;
  const result = { ...computedStock };
  for (const row of snapshot) {
    const r = row as unknown as Record<string, unknown>;
    const code = String(r.product_code ?? row.product_code ?? "").trim();
    const qty = toNumber(r.quantity ?? row.quantity);
    if (code) result[code] = qty;
  }
  return result;
}

/** 총 재고 금액 = SUM(total_price) 우선. total_price 없으면 수량×단가. 재고금액(재고금액) 사용, 재고원가(unit_cost)와 구분 */
export function computeTotalValueFromSnapshot(
  snapshot: StockSnapshotRow[] | null,
  products?: InventoryProduct[]
): number {
  if (!snapshot || snapshot.length === 0) return 0;
  const { stock, cost, totalPriceByCode } = getLatestSnapshotByProduct(snapshot);
  const sumFromTotalPrice = Object.values(totalPriceByCode).reduce((a, b) => a + b, 0);
  if (sumFromTotalPrice > 0) return Math.round(sumFromTotalPrice);
  const codeToCost = new Map<string, number>();
  if (products) {
    for (const p of products) {
      const c = toNumber(p.unit_cost);
      if (c > 0 && c <= MAX_UNIT_COST_KRW) {
        const k = normalizeCode(p.product_code) || String(p.product_code).trim();
        codeToCost.set(k, c);
        codeToCost.set(String(p.product_code).trim(), c);
      }
    }
  }
  let total = 0;
  for (const [code, qty] of Object.entries(stock)) {
    let c = cost[code] ?? codeToCost.get(code) ?? 0;
    if (c <= 0 || c > MAX_UNIT_COST_KRW) c = 0;
    total += qty * c;
  }
  return Math.round(total);
}

/** 제품별 재고 = sum(입고) - sum(출고) */
export function computeStockByProduct(
  products: InventoryProduct[],
  inbound: InventoryInbound[],
  outbound: InventoryOutbound[]
): Record<string, number> {
  const stock: Record<string, number> = {};
  const allCodes = new Set<string>();
  for (const p of products) allCodes.add(normalizeCode(p.product_code) || p.product_code);
  for (const i of inbound) allCodes.add(normalizeCode(i.product_code) || String(i.product_code).trim());
  for (const o of outbound) allCodes.add(normalizeCode(o.product_code) || String(o.product_code).trim());
  Array.from(allCodes).forEach((c) => { stock[c] = 0; });

  for (const i of inbound) {
    const code = normalizeCode(i.product_code) || String(i.product_code).trim();
    stock[code] = toNumber(stock[code]) + toNumber(i.quantity);
  }
  for (const o of outbound) {
    const code = normalizeCode(o.product_code) || String(o.product_code).trim();
    stock[code] = toNumber(stock[code]) - toNumber(o.quantity);
  }

  return stock;
}

/** (전체 입고량 - 전체 출고량) × 단가 방식 (current_products 비어있을 때 사용, 단가 없으면 스냅샷/평균) */
export function computeTotalValueFromInboundOutbound(
  inbound: InventoryInbound[],
  outbound: InventoryOutbound[],
  products: InventoryProduct[],
  stockSnapshot?: StockSnapshotRow[] | null
): number {
  const stockByProduct = computeStockByProduct(products, inbound, outbound);
  const codeToProduct = new Map(products.map((p) => [normalizeCode(p.product_code), p]));
  const snapshotCost = new Map(
    (stockSnapshot ?? []).filter((s) => toNumber(s.unit_cost) > 0 && toNumber(s.unit_cost) <= MAX_UNIT_COST_KRW).map((s) => [normalizeCode(s.product_code), toNumber(s.unit_cost)])
  );
  const costs: number[] = [];
  for (const p of products) {
    const c = toNumber(p.unit_cost);
    if (c > 0 && c <= MAX_UNIT_COST_KRW) costs.push(c);
  }
  snapshotCost.forEach((c) => costs.push(c));
  const avgCost = costs.length > 0 ? costs.reduce((a, b) => a + b, 0) / costs.length : 0;

  let total = 0;
  for (const [code, qty] of Object.entries(stockByProduct)) {
    const p = codeToProduct.get(normalizeCode(code)) ?? codeToProduct.get(String(code).trim());
    let cost = toNumber(p?.unit_cost) ?? toNumber(snapshotCost.get(normalizeCode(code))) ?? avgCost;
    if (cost > MAX_UNIT_COST_KRW || cost < 0) cost = avgCost;
    total += toNumber(qty) * (cost > 0 ? cost : avgCost);
  }
  return Math.round(total);
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
    const k = normalizeCode(p.product_code) || p.product_code;
    const qty = toNumber(stockByProduct[k]) || toNumber(stockByProduct[p.product_code]);
    const itemId = mapGroupToItemId(p.group_name) as ItemId;
    stock[itemId] = (stock[itemId] ?? 0) + qty;
  }
  return stock;
}

/** 총 재고 금액 = sum(제품별 재고 × unit_cost) - 품목코드(code) 기준 1회만 합산, 단가 비정상값 차단 */
export function computeTotalValue(
  stockByProduct: Record<string, number>,
  products: InventoryProduct[]
): number {
  const codeToProduct = new Map<string, InventoryProduct>();
  for (const p of products) {
    if (!codeToProduct.has(p.product_code)) {
      codeToProduct.set(p.product_code, p);
    }
  }
  let total = 0;
  codeToProduct.forEach((p, code) => {
    const qty = toNumber(stockByProduct[code]);
    let cost = toNumber(p.unit_cost);
    if (cost > MAX_UNIT_COST_KRW || cost < 0) {
      if (cost > MAX_UNIT_COST_KRW) console.warn("[inventory] 비정상 단가 차단:", p.product_code, cost, "원 → 0 처리");
      cost = 0;
    }
    total += qty * cost;
  });
  return Math.round(total);
}

/** inbound + outbound → Transaction[] (컴포넌트 호환) */
export function toTransactions(
  inbound: InventoryInbound[],
  outbound: InventoryOutbound[],
  products: InventoryProduct[]
): Transaction[] {
  const codeToGroup = new Map<string, string>();
  const codeToName = new Map<string, string>();
  for (const p of products) {
    const k = normalizeCode(p.product_code) || p.product_code;
    const group = (p.category ?? p.group_name ?? "기타").trim();
    codeToGroup.set(k, group);
    codeToGroup.set(p.product_code, group);
    codeToName.set(k, p.product_name);
    codeToName.set(p.product_code, p.product_name);
  }
  const txs: Transaction[] = [];

  for (const i of inbound) {
    const k = normalizeCode(i.product_code) || String(i.product_code).trim();
    const rowCat = (i.category ?? "").trim();
    const group = (rowCat && rowCat !== "기타") ? rowCat : (codeToGroup.get(k) ?? codeToGroup.get(i.product_code) ?? "기타");
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
      salesChannel: "general", // 입고에는 채널 미사용
    });
  }
  for (const o of outbound) {
    const k = normalizeCode(o.product_code) || String(o.product_code).trim();
    const rowCat = (o.category ?? "").trim();
    const group = (rowCat && rowCat !== "기타") ? rowCat : (codeToGroup.get(k) ?? codeToGroup.get(o.product_code) ?? "기타");
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
      salesChannel: /coupang|쿠팡/.test(String(o.sales_channel ?? "")) ? "coupang" : "general",
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
  const allCodes = new Set<string>();
  for (const p of products) allCodes.add(p.product_code);
  for (const i of inbound) allCodes.add(i.product_code);
  for (const o of outbound) allCodes.add(o.product_code);
  const coupang: Record<string, number> = {};
  const general: Record<string, number> = {};
  Array.from(allCodes).forEach((c) => {
    coupang[c] = 0;
    general[c] = 0;
  });
  const toChannel = (v: string | null | undefined) => {
    const ch = (v || "").toString().toLowerCase().trim();
    if (ch === "coupang" || ch === "쿠팡" || ch.includes("쿠팡")) return "coupang";
    return "general";
  };
  for (const i of inbound) {
    // 입고에는 채널 미사용 → general에만 반영
    const t = general;
    const code = normalizeCode(i.product_code) || String(i.product_code).trim();
    t[code] = toNumber(t[code]) + toNumber(i.quantity);
  }
  for (const o of outbound) {
    const ch = toChannel(o.sales_channel ?? (o as { channel?: string }).channel);
    const t = ch === "coupang" ? coupang : general;
    const code = normalizeCode(o.product_code) || String(o.product_code).trim();
    t[code] = toNumber(t[code]) - toNumber(o.quantity);
  }
  return { coupang, general };
}

/** 전체 기간 입고/출고 건수 (데이터가 있는 전체 기간 합산) */
export function getTodayInOutCount(
  inbound: InventoryInbound[],
  outbound: InventoryOutbound[]
): { inbound: number; outbound: number } {
  let inCount = 0;
  let outCount = 0;
  for (const i of inbound) {
    inCount += toNumber(i.quantity) > 0 ? 1 : 0;
  }
  for (const o of outbound) {
    outCount += toNumber(o.quantity) > 0 ? 1 : 0;
  }
  return { inbound: inCount, outbound: outCount };
}

/**
 * 제품별 안전재고: 최근 3개월 평균 판매량의 10% (임시 기준)
 * 품절 임박 = 재고 ≤ 안전재고 또는 재고 ≤ 0
 */
export function computeSafetyStockByProduct(
  outbound: InventoryOutbound[],
  products: InventoryProduct[]
): Record<string, number> {
  const now = new Date();
  const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  const cutoffStr = threeMonthsAgo.toISOString().slice(0, 10);

  const outByProduct: Record<string, number> = {};
  for (const o of outbound) {
    if ((o.outbound_date ?? "").slice(0, 10) < cutoffStr) continue;
    const code = normalizeCode(o.product_code) || String(o.product_code).trim();
    outByProduct[code] = toNumber(outByProduct[code]) + toNumber(o.quantity);
  }

  const result: Record<string, number> = {};
  for (const p of products) {
    const code = normalizeCode(p.product_code) || p.product_code;
    const total3Month = toNumber(outByProduct[code]) || toNumber(outByProduct[p.product_code]);
    result[code] = Math.max(0, Math.ceil(total3Month * 0.1));
  }
  const allCodes = new Set<string>([...Object.keys(outByProduct), ...Object.keys(result)]);
  Array.from(allCodes).forEach((c) => {
    if (result[c] != null && result[c] > 0) return;
    const total3Month = toNumber(outByProduct[c]);
    result[c] = Math.max(0, Math.ceil(total3Month * 0.1));
  });
  return result;
}

/** 전체 기간 일평균 출고량 (제품별) - 과재고 판단용 */
export function computeAvg60DayOutboundByProduct(
  outbound: InventoryOutbound[]
): Record<string, number> {
  const dailyByProduct: Record<string, Record<string, number>> = {};
  for (const o of outbound) {
    const code = normalizeCode(o.product_code) || String(o.product_code).trim();
    const date = (o.outbound_date ?? "").slice(0, 10);
    if (!date) continue;
    if (!dailyByProduct[code]) dailyByProduct[code] = {};
    dailyByProduct[code][date] =
      toNumber(dailyByProduct[code][date]) + toNumber(o.quantity);
  }

  const result: Record<string, number> = {};
  for (const [code, daily] of Object.entries(dailyByProduct)) {
    const dayCount = Object.keys(daily).length;
    if (dayCount === 0) continue;
    const total = Object.values(daily).reduce((a, b) => a + toNumber(b), 0);
    result[code] = total / dayCount;
  }
  return result;
}

/** 전체 기간 일평균 출고량 (제품별) - 수요 예측·권장 발주량용 */
export function computeAvg30DayOutboundByProduct(
  outbound: InventoryOutbound[]
): Record<string, number> {
  return computeAvg60DayOutboundByProduct(outbound);
}

/** sales_channel(매출구분)이 쿠팡인지 판별. 출고 시트 매출구분 → DB sales_channel */
function isCoupangSalesChannel(ch: string | null | undefined): boolean {
  const s = String(ch ?? "").trim().toLowerCase();
  return s === "coupang" || s === "쿠팡" || s.includes("쿠팡") || s.includes("coupang");
}

/** 최근 N일 일평균 출고량 - 캘린더 일수 기준 (수요 예측용) */
export function computeAvgNDayOutboundByProduct(
  outbound: InventoryOutbound[],
  days: number = 30
): Record<string, number> {
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const totalByProduct: Record<string, number> = {};
  for (const o of outbound) {
    if (o.outbound_date < cutoffStr) continue;
    totalByProduct[o.product_code] =
      (totalByProduct[o.product_code] ?? 0) + o.quantity;
  }

  const result: Record<string, number> = {};
  for (const [code, total] of Object.entries(totalByProduct)) {
    result[code] = total / days;
  }
  return result;
}

/** 최근 N일 일평균 출고량 - 채널별 (쿠팡/일반 판매 기준) */
export function computeAvgNDayOutboundByProductByChannel(
  outbound: InventoryOutbound[],
  days: number = 30
): { coupang: Record<string, number>; general: Record<string, number> } {
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const coupang: Record<string, number> = {};
  const general: Record<string, number> = {};
  for (const o of outbound) {
    if (o.outbound_date < cutoffStr) continue;
    const code = o.product_code;
    if (isCoupangSalesChannel(o.sales_channel)) {
      coupang[code] = (coupang[code] ?? 0) + o.quantity;
    } else {
      general[code] = (general[code] ?? 0) + o.quantity;
    }
  }
  const resultCoupang: Record<string, number> = {};
  const resultGeneral: Record<string, number> = {};
  for (const [code, total] of Object.entries(coupang)) {
    resultCoupang[code] = total / days;
  }
  for (const [code, total] of Object.entries(general)) {
    resultGeneral[code] = total / days;
  }
  return { coupang: resultCoupang, general: resultGeneral };
}

/** 일자별 출고 집계 (분석용) */
export function getDailyOutboundByProduct(
  outbound: InventoryOutbound[],
  days: number = 30
): Record<string, Record<string, number>> {
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const dailyByProduct: Record<string, Record<string, number>> = {};
  for (const o of outbound) {
    if (o.outbound_date < cutoffStr) continue;
    const date = o.outbound_date.slice(0, 10);
    if (!dailyByProduct[o.product_code]) dailyByProduct[o.product_code] = {};
    dailyByProduct[o.product_code][date] =
      (dailyByProduct[o.product_code][date] ?? 0) + o.quantity;
  }
  return dailyByProduct;
}

/**
 * 권장 입고 수량 = (안전재고 - 현재재고) + (일평균 출고량 × 리드타임)
 * 품절 임박(보유 ≤3일) 품목: 최소 14일분 보충 권장
 */
export function computeRecommendedOrderByProduct(
  stockByProduct: Record<string, number>,
  avgDailyOutbound: Record<string, number>,
  products: InventoryProduct[],
  safetyStockByProduct?: Record<string, number>
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const p of products) {
    const code = normalizeCode(p.product_code) || p.product_code;
    const stock = Math.max(0, stockByProduct[code] ?? stockByProduct[p.product_code] ?? 0);
    const avgDaily = avgDailyOutbound[code] ?? avgDailyOutbound[p.product_code] ?? 0;
    const leadTime = p.lead_time_days ?? DEFAULT_LEAD_TIME_DAYS;
    const safety = toNumber(safetyStockByProduct?.[code] ?? safetyStockByProduct?.[p.product_code]);
    const shortfall = safety > 0 ? Math.max(0, safety - stock) : 0;
    const demandDuringLead = avgDaily * leadTime;
    let recommended = Math.max(0, Math.ceil(shortfall + demandDuringLead));
    // 품절 임박(보유 ≤3일): 최소 14일분 수요 보충 권장
    if (avgDaily > 0) {
      const daysOfStock = stock / avgDaily;
      if (daysOfStock <= 3) {
        const minFor14Days = Math.ceil(avgDaily * 14 - stock);
        recommended = Math.max(recommended, Math.max(0, minFor14Days));
      }
    }
    if (recommended > 0) result[p.product_code] = recommended;
  }
  return result;
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
