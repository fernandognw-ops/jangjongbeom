/**
 * 웹 승인 기반 DB 반영 로직 (서버 전용)
 * - 당월 stock_snapshot만 반영 (과거월 보호)
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { InboundRow, OutboundRow, StockSnapshotRow } from "@/lib/productionSheetParser";
import { toDestWarehouse } from "@/lib/excelParser/classifier";

const TABLE_PRODUCTS = "inventory_products";
const TABLE_INBOUND = "inventory_inbound";
const TABLE_OUTBOUND = "inventory_outbound";
const TABLE_CURRENT = "inventory_current_products";
const TABLE_SNAPSHOT = "inventory_stock_snapshot";
const BATCH = 300;

function ensureChannel(ch: string | undefined | null): "coupang" | "general" {
  const s = String(ch ?? "").trim().toLowerCase();
  if (s === "쿠팡" || s.includes("쿠팡") || s === "coupang") return "coupang";
  return "general";
}

function ensureDestWarehouse(wh: string | undefined | null): string {
  const s = String(wh ?? "").trim();
  if (!s) return "일반";
  return toDestWarehouse(s);
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

  let inboundInserted = 0;
  if (inbound.length > 0) {
    const dates = [...new Set(inbound.map((r) => r.inbound_date))];
    if (dates.length > 0) {
      await supabase.from(TABLE_INBOUND).delete().in("inbound_date", dates);
    }
    const rows = inbound.map((r) => ({
      product_code: r.product_code,
      quantity: r.quantity,
      inbound_date: r.inbound_date,
      dest_warehouse: ensureDestWarehouse(r.dest_warehouse),
      ...(r.category && { category: r.category }),
    }));
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
    const dates = [...new Set(outbound.map((r) => r.outbound_date))];
    if (dates.length > 0) {
      await supabase.from(TABLE_OUTBOUND).delete().in("outbound_date", dates);
    }
    const byKey = new Map<string, { product_code: string; quantity: number; outbound_date: string; sales_channel: "coupang" | "general"; dest_warehouse: string; category?: string }>();
    for (const r of outbound) {
      const wh = ensureDestWarehouse(r.dest_warehouse);
      const ch = ensureChannel(r.sales_channel);
      const k = `${r.product_code}|${r.outbound_date}|${wh}`;
      const existing = byKey.get(k);
      if (existing) {
        existing.quantity += r.quantity;
      } else {
        byKey.set(k, { product_code: r.product_code, quantity: r.quantity, outbound_date: r.outbound_date, sales_channel: ch, dest_warehouse: wh, ...(r.category && { category: r.category }) });
      }
    }
    const rows = Array.from(byKey.values());
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
    const monthStart = today.slice(0, 7) + "-01";
    const lastDay = new Date(new Date(today).getFullYear(), new Date(today).getMonth() + 1, 0).getDate();
    const monthEnd = today.slice(0, 7) + "-" + String(lastDay).padStart(2, "0");

    const codes = Array.from(new Set(stockSnapshot.map((s) => s.product_code)));
    const [existingSnap, productsCost] = await Promise.all([
      supabase.from(TABLE_SNAPSHOT).select("product_code,dest_warehouse,unit_cost").in("product_code", codes),
      supabase.from(TABLE_PRODUCTS).select("product_code,unit_cost").in("product_code", codes),
    ]);
    const costByKey = new Map<string, number>();
    const costByCode = new Map<string, number>();
    for (const r of existingSnap.data ?? []) {
      const row = r as { product_code: string; dest_warehouse?: string; unit_cost: number };
      const key = `${row.product_code}|${(row.dest_warehouse ?? "").trim() || "일반"}`;
      if ((row.unit_cost ?? 0) > 0) costByKey.set(key, row.unit_cost);
    }
    for (const r of productsCost.data ?? []) {
      const p = r as { product_code: string; unit_cost: number };
      if ((p.unit_cost ?? 0) > 0) costByCode.set(p.product_code, p.unit_cost);
    }

    const snapshotRows = stockSnapshot.map((s) => {
      const wh = ensureDestWarehouse(s.dest_warehouse);
      const snap = (s.snapshot_date ?? today).slice(0, 10);
      let cost = s.unit_cost ?? 0;
      if (cost <= 0) cost = costByKey.get(`${s.product_code}|${wh}`) ?? costByCode.get(s.product_code) ?? 0;
      const qty = s.quantity ?? 0;
      const totalPrice = qty * cost;
      return {
        product_code: s.product_code,
        dest_warehouse: wh,
        quantity: qty,
        unit_cost: cost,
        total_price: totalPrice,
        snapshot_date: snap,
      };
    });

    const currentMonthRows = snapshotRows.filter((r) => {
      const d = r.snapshot_date;
      return d && monthStart <= d && d <= monthEnd;
    });

    if (currentMonthRows.length > 0) {
      const datesToReplace = [...new Set(currentMonthRows.map((r) => r.snapshot_date).filter(Boolean))];
      if (datesToReplace.length > 0) {
        await supabase.from(TABLE_SNAPSHOT).delete().in("snapshot_date", datesToReplace);
      }
      for (let i = 0; i < currentMonthRows.length; i += BATCH) {
        const batch = currentMonthRows.slice(i, i + BATCH);
        const { error } = await supabase.from(TABLE_SNAPSHOT).insert(batch);
        if (error) throw new Error(`재고 스냅샷 저장 실패: ${error.message}`);
        stockSnapshotCount += batch.length;
        onLog?.(TABLE_SNAPSHOT, batch.length);
      }
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
