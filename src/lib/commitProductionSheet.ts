/**
 * 웹 승인 기반 DB 반영 로직 (서버 전용)
 * - 재고: 업로드에 포함된 **달력 월(YYYY-MM)** 마다, 그 달의 기존 스냅샷 전부 DELETE 후 INSERT.
 *   → 같은 달에 새 파일이 오면 해당 월은 **그 파일의 snapshot_date만** 남도록 이전 일자 스냅샷이 제거됨.
 * - 입고/출고: 파일에 나온 inbound_date / outbound_date 집합만 DELETE 후 INSERT (누적 append 금지)
 * - inbound/outbound/stock 적재 전 inventory_products 기준 enrichment
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { InboundRow, OutboundRow, StockSnapshotRow } from "@/lib/productionSheetParser";
import { toDestWarehouse } from "@/lib/excelParser/classifier";
import { normalizeSalesChannelKr } from "@/lib/inventoryChannels";

const TABLE_PRODUCTS = "inventory_products";
const TABLE_INBOUND = "inventory_inbound";
const TABLE_OUTBOUND = "inventory_outbound";
const TABLE_CURRENT = "inventory_current_products";
const TABLE_SNAPSHOT = "inventory_stock_snapshot";
const BATCH = 300;

/** YYYY-MM-DD 정규화 */
function normDateYmd(d: string | undefined | null): string {
  const s = String(d ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

/** snapshot_date 문자열에서 서로 다른 YYYY-MM 목록 */
function distinctCalendarMonthsFromSnapshotDates(dates: string[]): string[] {
  const set = new Set<string>();
  for (const raw of dates) {
    const ymd = normDateYmd(raw) || String(raw).trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) continue;
    set.add(ymd.slice(0, 7));
  }
  return [...set].sort();
}

/** 다음 달 1일 (exclusive 상한용): YYYY-MM → YYYY-MM-DD */
function firstDayOfNextCalendarMonth(ym: string): string {
  const [yStr, mStr] = ym.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  if (m === 12) return `${y + 1}-01-01`;
  return `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

interface ProductEnrichment {
  product_name: string;
  category: string;
  pack_size: number;
  unit_cost: number;
}

function ensureChannel(ch: string | undefined | null): "coupang" | "general" {
  const s = String(ch ?? "").trim().toLowerCase();
  if (s === "쿠팡" || s.includes("쿠팡") || s === "coupang") return "coupang";
  return "general";
}

/** 입고·레거시 창고명 → 쿠팡|일반 (출고 행에는 사용하지 않음) */
function ensureDestWarehouse(wh: string | undefined | null): string {
  const s = String(wh ?? "").trim();
  if (!s) return "일반";
  return toDestWarehouse(s);
}

/** 출고: dest_warehouse는 출고센터(물류) 의미로만 저장 */
function outboundDestForDb(r: OutboundRow): string {
  return ensurePhysicalWarehouse(r.outbound_center ?? r.dest_warehouse);
}

function ensurePhysicalWarehouse(wh: string | undefined | null): string {
  const s = String(wh ?? "").trim();
  return s || "미지정";
}

async function fetchProductEnrichmentMap(
  supabase: SupabaseClient,
  productCodes: string[],
  onWarning?: (msg: string) => void
): Promise<Map<string, ProductEnrichment>> {
  const codes = [...new Set(productCodes)].filter(Boolean);
  if (codes.length === 0) return new Map();
  const map = new Map<string, ProductEnrichment>();
  for (let i = 0; i < codes.length; i += 500) {
    const batch = codes.slice(i, i + 500);
    const { data, error } = await supabase
      .from(TABLE_PRODUCTS)
      .select("product_code,product_name,category,pack_size,unit_cost")
      .in("product_code", batch);
    if (error) throw new Error(`제품 조회 실패: ${error.message}`);
    for (const r of data ?? []) {
      const row = r as { product_code: string; product_name?: string; category?: string; pack_size?: number; unit_cost?: number };
      map.set(row.product_code, {
        product_name: (row.product_name ?? row.product_code).trim() || row.product_code,
        category: (row.category ?? "기타").trim() || "기타",
        pack_size: Math.max(1, row.pack_size ?? 1),
        unit_cost: Number(row.unit_cost) || 0,
      });
    }
  }
  const missing = codes.filter((c) => !map.has(c));
  if (missing.length > 0 && onWarning) {
    onWarning(`[enrichment] inventory_products에 없는 product_code: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? ` 외 ${missing.length - 10}건` : ""}`);
  }
  return map;
}

export interface CommitInput {
  filename: string;
  inbound: InboundRow[];
  outbound: OutboundRow[];
  stockSnapshot: StockSnapshotRow[];
  rawdata: Array<{ product_code: string; product_name?: string; unit_cost?: number; category?: string; pack_size?: number }>;
  currentProductCodes: string[];
}

export interface CommitResult {
  products: number;
  inboundInserted: number;
  outboundInserted: number;
  stockSnapshotCount: number;
  currentProducts: number;
}

export async function commitProductionSheet(
  supabase: SupabaseClient,
  input: CommitInput,
  onLog?: (table: string, rows: number) => void
): Promise<CommitResult> {
  const { filename, inbound, outbound, stockSnapshot, rawdata, currentProductCodes } = input;

  if (rawdata.length > 0) {
    const productRows = rawdata.map((r) => ({
      product_code: r.product_code,
      product_name: (r.product_name ?? r.product_code).trim() || r.product_code,
      unit_cost: r.unit_cost ?? 0,
      category: (r.category ?? "기타").trim() || "기타",
      pack_size: Math.max(1, r.pack_size ?? 1),
    }));
    for (let i = 0; i < productRows.length; i += BATCH) {
      const batch = productRows.slice(i, i + BATCH);
      const { error } = await supabase.from(TABLE_PRODUCTS).upsert(batch, { onConflict: "product_code" });
      if (error) throw new Error(`제품 등록 실패: ${error.message}`);
      onLog?.(TABLE_PRODUCTS, batch.length);
    }
  } else {
    const allCodes = new Set<string>();
    for (const r of inbound) allCodes.add(r.product_code);
    for (const r of outbound) allCodes.add(r.product_code);
    for (const r of stockSnapshot) allCodes.add(r.product_code);
    const productsRes = await supabase.from(TABLE_PRODUCTS).select("product_code");
    const existingCodes = new Set((productsRes.data ?? []).map((r) => (r as { product_code: string }).product_code));
    const toCreate = Array.from(allCodes).filter((c) => !existingCodes.has(c));
    if (toCreate.length > 0) {
      const newProducts = toCreate.map((code) => ({
        product_code: code,
        product_name: code,
        unit_cost: 0,
        category: "기타",
        pack_size: 1,
      }));
      for (let i = 0; i < newProducts.length; i += BATCH) {
        const batch = newProducts.slice(i, i + BATCH);
        const { error } = await supabase.from(TABLE_PRODUCTS).upsert(batch, { onConflict: "product_code" });
        if (error) throw new Error(`제품 등록 실패: ${error.message}`);
        onLog?.(TABLE_PRODUCTS, batch.length);
      }
    }
  }

  const allCodes = new Set<string>();
  for (const r of inbound) allCodes.add(r.product_code);
  for (const r of outbound) allCodes.add(r.product_code);
  for (const r of stockSnapshot) allCodes.add(r.product_code);
  const productMap = await fetchProductEnrichmentMap(
    supabase,
    Array.from(allCodes),
    (msg) => console.warn(msg)
  );

  let inboundInserted = 0;
  if (inbound.length > 0) {
    const dates = [...new Set(inbound.map((r) => normDateYmd(r.inbound_date)).filter(Boolean))];
    if (dates.length > 0) {
      await supabase.from(TABLE_INBOUND).delete().in("inbound_date", dates);
    }
    const rows = inbound.map((r) => {
      const p = productMap.get(r.product_code);
      const unitPrice = p?.unit_cost ?? 0;
      const qty = r.quantity ?? 0;
      const totalPrice = qty * unitPrice;
      return {
        product_code: r.product_code,
        product_name: p?.product_name ?? r.product_code,
        category: p?.category ?? "기타",
        pack_size: p?.pack_size ?? 1,
        quantity: qty,
        inbound_date: normDateYmd(r.inbound_date) || r.inbound_date,
        dest_warehouse: ensureDestWarehouse(r.dest_warehouse),
        unit_price: unitPrice,
        total_price: totalPrice,
      };
    });
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const { error } = await supabase.from(TABLE_INBOUND).insert(batch);
      if (error) throw new Error(`입고 저장 실패: ${error.message}`);
      inboundInserted += batch.length;
      onLog?.(TABLE_INBOUND, batch.length);
    }
  }

  let outboundInserted = 0;
  if (outbound.length > 0) {
    const dates = [...new Set(outbound.map((r) => normDateYmd(r.outbound_date)).filter(Boolean))];
    if (dates.length > 0) {
      await supabase.from(TABLE_OUTBOUND).delete().in("outbound_date", dates);
    }
    const rows = outbound.map((r) => {
      const p = productMap.get(r.product_code);
      const unitPrice = (r.unit_price ?? 0) > 0 ? (r.unit_price ?? 0) : (p?.unit_cost ?? 0);
      const qty = r.quantity ?? 0;
      const outboundTotalAmount =
        (r.outbound_total_amount ?? 0) > 0
          ? (r.outbound_total_amount ?? 0)
          : (r.total_price ?? 0) > 0
            ? (r.total_price ?? 0)
            : 0;
      const totalPrice = outboundTotalAmount > 0 ? outboundTotalAmount : qty * unitPrice;
      return {
        product_code: r.product_code,
        product_name: p?.product_name ?? r.product_code,
        category: p?.category ?? "기타",
        pack_size: p?.pack_size ?? 1,
        quantity: qty,
        outbound_date: normDateYmd(r.outbound_date) || r.outbound_date,
        sales_channel: ensureChannel(r.sales_channel),
        dest_warehouse: outboundDestForDb(r),
        unit_price: unitPrice,
        total_price: totalPrice,
        outbound_total_amount: outboundTotalAmount,
      };
    });
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const { error } = await supabase.from(TABLE_OUTBOUND).insert(batch);
      if (error) throw new Error(`출고 저장 실패: ${error.message}`);
      outboundInserted += batch.length;
      onLog?.(TABLE_OUTBOUND, batch.length);
    }
  }

  if (currentProductCodes.length > 0) {
    const currentRows = currentProductCodes.map((c) => ({ product_code: c }));
    for (let i = 0; i < currentRows.length; i += BATCH) {
      const batch = currentRows.slice(i, i + BATCH);
      const { error } = await supabase.from(TABLE_CURRENT).upsert(batch, { onConflict: "product_code" });
      if (error) throw new Error(`현재 품목 동기화 실패: ${error.message}`);
      onLog?.(TABLE_CURRENT, batch.length);
    }
  }

  let stockSnapshotCount = 0;
  if (stockSnapshot.length > 0) {
    const today = new Date().toISOString().slice(0, 10);

    const codes = Array.from(new Set(stockSnapshot.map((s) => s.product_code)));
    const existingSnap = await supabase
      .from(TABLE_SNAPSHOT)
      .select("product_code,dest_warehouse,storage_center,unit_cost,sales_channel")
      .in("product_code", codes);
    const costByKey = new Map<string, number>();
    for (const r of existingSnap.data ?? []) {
      const row = r as {
        product_code: string;
        dest_warehouse?: string;
        storage_center?: string;
        sales_channel?: string;
        unit_cost: number;
      };
      const ch = normalizeSalesChannelKr(row.dest_warehouse ?? row.sales_channel ?? "");
      const st = (row.storage_center ?? "").trim() || "미지정";
      const key = `${row.product_code}|${ch}|${st}`;
      if ((row.unit_cost ?? 0) > 0) costByKey.set(key, row.unit_cost);
    }

    /** dest_warehouse=판매채널, storage_center=보관센터. sales_channel은 레거시 스키마 호환용으로 동일 값 복제 */
    const snapshotRows = stockSnapshot.map((s) => {
      const p = productMap.get(s.product_code);
      const channel = normalizeSalesChannelKr(s.dest_warehouse ?? "");
      const storage = ensurePhysicalWarehouse(s.storage_center);
      const snap = normDateYmd(s.snapshot_date) || (s.snapshot_date ?? today).slice(0, 10);
      let cost = s.unit_cost ?? 0;
      if (cost <= 0) {
        cost =
          costByKey.get(`${s.product_code}|${channel}|${storage}`) ??
          costByKey.get(`${s.product_code}|${channel}|미지정`) ??
          p?.unit_cost ??
          0;
      }
      const qty = s.quantity ?? 0;
      const totalPrice = qty * cost;
      return {
        product_code: s.product_code,
        product_name: p?.product_name ?? s.product_code,
        category: p?.category ?? "기타",
        pack_size: p?.pack_size ?? 1,
        dest_warehouse: channel,
        storage_center: storage,
        sales_channel: channel,
        quantity: qty,
        unit_cost: cost,
        total_price: totalPrice,
        snapshot_date: snap,
      };
    });

    const monthsToReplace = distinctCalendarMonthsFromSnapshotDates(
      snapshotRows.map((r) => r.snapshot_date).filter(Boolean) as string[]
    );
    for (const ym of monthsToReplace) {
      const monthStart = `${ym}-01`;
      const beforeNext = firstDayOfNextCalendarMonth(ym);
      const { error: delErr } = await supabase
        .from(TABLE_SNAPSHOT)
        .delete()
        .gte("snapshot_date", monthStart)
        .lt("snapshot_date", beforeNext);
      if (delErr) throw new Error(`재고 스냅샷 월 삭제 실패 (${ym}): ${delErr.message}`);
    }
    for (let i = 0; i < snapshotRows.length; i += BATCH) {
      const batch = snapshotRows.slice(i, i + BATCH) as Array<
        Record<string, unknown> & { dest_warehouse: string; storage_center: string }
      >;
      if (i === 0 && batch[0] && !("storage_center" in batch[0])) {
        throw new Error("재고 스냅샷 insert: storage_center 누락 (코드 오류)");
      }
      const { error } = await supabase.from(TABLE_SNAPSHOT).insert(batch);
      if (error) throw new Error(`재고 스냅샷 저장 실패: ${error.message}`);
      stockSnapshotCount += batch.length;
      onLog?.(TABLE_SNAPSHOT, batch.length);
    }
  }

  return {
    products: rawdata.length > 0 ? rawdata.length : 0,
    inboundInserted,
    outboundInserted,
    stockSnapshotCount,
    currentProducts: currentProductCodes.length,
  };
}
