/**
 * 웹 승인 기반 DB 반영 로직 (서버 전용)
 * - 입고/출고/재고: **source_row_key**(원본행 핑거프린트)로 upsert. 동일 키 재업로드 시 update(덮어쓰기).
 * - 날짜·월 단위 DELETE 후 전량 재삽입 없음 → 누적 DB에서 과거 월·타 월 데이터 유지.
 * - inbound/outbound/stock 적재 전 inventory_products 기준 enrichment
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { InboundRow, OutboundRow, StockSnapshotRow } from "@/lib/productionSheetParser";
import { normalizeSalesChannelKr } from "@/lib/inventoryChannels";
import { buildUploadSourceRowKey } from "@/lib/uploadSourceRowKey";

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

interface ProductEnrichment {
  product_name: string;
  category: string;
  pack_size: number;
  unit_cost: number;
}

function ensureChannel(ch: string | undefined | null): "coupang" | "general" {
  const raw = String(ch ?? "").trim();
  const s = raw.toLowerCase();
  if (s === "coupang" || s === "general") return s as "coupang" | "general";
  if (raw.includes("쿠팡") || s.includes("coupang")) return "coupang";
  return "general";
}

/** 출고: dest_warehouse는 출고센터(물류) 의미로만 저장 */
function outboundDestForDb(r: OutboundRow): string {
  return ensurePhysicalWarehouse(r.outbound_center ?? r.dest_warehouse);
}

function ensurePhysicalWarehouse(wh: string | undefined | null): string {
  const s = String(wh ?? "").trim();
  return s || "미지정";
}

function dedupeBySourceRowKey<T extends { source_row_key: string }>(rows: T[]): T[] {
  const map = new Map<string, T>();
  for (const r of rows) map.set(r.source_row_key, r);
  return [...map.values()];
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
    const codes = Array.from(new Set(rawdata.map((r) => r.product_code)));
    const { data: existingProducts } = await supabase
      .from(TABLE_PRODUCTS)
      .select("product_code,category,pack_size")
      .in("product_code", codes);

    const productMetaByCode = new Map<
      string,
      { category?: string | null; pack_size?: number | null }
    >();
    for (const r of existingProducts ?? []) {
      const row = r as { product_code: string; category?: string | null; pack_size?: number | null };
      productMetaByCode.set(row.product_code, { category: row.category, pack_size: row.pack_size });
    }

    const productRows = rawdata.map((r) => {
      const meta = productMetaByCode.get(r.product_code);
      const categoryRaw = r.category != null ? String(r.category) : meta?.category ?? null;
      const packSizeRaw = r.pack_size != null ? r.pack_size : meta?.pack_size ?? null;
      const productNameRaw = r.product_name;

      if (categoryRaw == null || String(categoryRaw).trim() === "") {
        throw new Error(`[commitProductionSheet] rawdata로는 category 기본값을 주입하지 않습니다. product_code=${r.product_code}`);
      }
      if (!productNameRaw || String(productNameRaw).trim() === "") {
        throw new Error(`[commitProductionSheet] rawdata로는 product_name이 비어있는 값을 허용하지 않습니다. product_code=${r.product_code}`);
      }
      if (r.unit_cost == null || !Number.isFinite(Number(r.unit_cost)) || Number(r.unit_cost) < 0) {
        throw new Error(`[commitProductionSheet] rawdata로는 원가(unit_cost)가 비정상인 값을 허용하지 않습니다. product_code=${r.product_code}`);
      }
      if (packSizeRaw == null || !Number.isFinite(Number(packSizeRaw))) {
        throw new Error(`[commitProductionSheet] rawdata로는 pack_size 기본값을 주입하지 않습니다. product_code=${r.product_code}`);
      }

      const pack_sizeNum = Math.max(1, Number(packSizeRaw));
      if (!Number.isFinite(pack_sizeNum) || pack_sizeNum < 1) {
        throw new Error(`[commitProductionSheet] pack_size 값이 올바르지 않습니다. product_code=${r.product_code}`);
      }

      return {
        product_code: r.product_code,
        product_name: String(productNameRaw).trim(),
        unit_cost: Number(r.unit_cost),
        category: String(categoryRaw).trim(),
        pack_size: pack_sizeNum,
      };
    });
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
    const rows = dedupeBySourceRowKey(inbound.map((r) => {
      const p = productMap.get(r.product_code);
      const unitPrice = p?.unit_cost ?? 0;
      const qty = r.quantity ?? 0;
      const totalPrice = qty * unitPrice;
      const dateYmd = normDateYmd(r.inbound_date) || String(r.inbound_date).trim().slice(0, 10);
      const ch = ensureChannel(r.sales_channel);
      const center = r.inbound_center?.trim() || "";
      const source_row_key = buildUploadSourceRowKey({
        sheet: "inbound",
        dateYmd,
        salesChannel: ch,
        productCode: r.product_code,
        quantity: qty,
        amount: totalPrice,
        center,
      });
      return {
        source_row_key,
        product_code: r.product_code,
        product_name: p?.product_name ?? r.product_code,
        category: p?.category ?? "기타",
        pack_size: p?.pack_size ?? 1,
        quantity: qty,
        inbound_date: dateYmd,
        sales_channel: ch,
        source_warehouse: center || null,
        dest_warehouse: null,
        unit_price: unitPrice,
        total_price: totalPrice,
      };
    }));
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const { error } = await supabase.from(TABLE_INBOUND).upsert(batch, { onConflict: "source_row_key" });
      if (error) throw new Error(`입고 저장 실패: ${error.message}`);
      inboundInserted += batch.length;
      onLog?.(TABLE_INBOUND, batch.length);
    }
  }

  let outboundInserted = 0;
  if (outbound.length > 0) {
    const rows = dedupeBySourceRowKey(outbound.map((r) => {
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
      const dateYmd = normDateYmd(r.outbound_date) || String(r.outbound_date).trim().slice(0, 10);
      const ch = ensureChannel(r.sales_channel);
      const center = outboundDestForDb(r);
      const source_row_key = buildUploadSourceRowKey({
        sheet: "outbound",
        dateYmd,
        salesChannel: ch,
        productCode: r.product_code,
        quantity: qty,
        amount: totalPrice,
        center,
      });
      return {
        source_row_key,
        product_code: r.product_code,
        product_name: p?.product_name ?? r.product_code,
        category: p?.category ?? "기타",
        pack_size: p?.pack_size ?? 1,
        quantity: qty,
        outbound_date: dateYmd,
        sales_channel: ch,
        dest_warehouse: center,
        unit_price: unitPrice,
        total_price: totalPrice,
        outbound_total_amount: outboundTotalAmount,
      };
    }));
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const { error } = await supabase.from(TABLE_OUTBOUND).upsert(batch, { onConflict: "source_row_key" });
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
      if (!row.sales_channel || String(row.sales_channel).trim() === "") {
        throw new Error("[commitProductionSheet] inventory_stock_snapshot row has empty sales_channel; refusing to default.");
      }
      const ch = normalizeSalesChannelKr(String(row.sales_channel));
      const st = (row.storage_center ?? "").trim() || "미지정";
      const key = `${row.product_code}|${ch}|${st}`;
      if ((row.unit_cost ?? 0) > 0) costByKey.set(key, row.unit_cost);
    }

    /** dest_warehouse=판매채널, storage_center=보관센터. sales_channel은 레거시 스키마 호환용으로 동일 값 복제 */
    const snapshotRows = dedupeBySourceRowKey(stockSnapshot.map((s) => {
      const p = productMap.get(s.product_code);
      const channel = normalizeSalesChannelKr(s.sales_channel);
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
      const ch = ensureChannel(s.sales_channel);
      const source_row_key = buildUploadSourceRowKey({
        sheet: "snapshot",
        dateYmd: snap,
        salesChannel: ch,
        productCode: s.product_code,
        quantity: qty,
        amount: totalPrice,
        center: storage,
      });
      return {
        source_row_key,
        product_code: s.product_code,
        product_name: p?.product_name ?? s.product_code,
        category: p?.category ?? "기타",
        pack_size: p?.pack_size ?? 1,
        dest_warehouse: channel,
        storage_center: storage,
        sales_channel: ch,
        quantity: qty,
        unit_cost: cost,
        total_price: totalPrice,
        snapshot_date: snap,
      };
    }));

    for (let i = 0; i < snapshotRows.length; i += BATCH) {
      const batch = snapshotRows.slice(i, i + BATCH) as Array<
        Record<string, unknown> & { dest_warehouse: string; storage_center: string }
      >;
      if (i === 0 && batch[0] && !("storage_center" in batch[0])) {
        throw new Error("재고 스냅샷 insert: storage_center 누락 (코드 오류)");
      }
      const { error } = await supabase.from(TABLE_SNAPSHOT).upsert(batch, { onConflict: "source_row_key" });
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
