/**
 * 생산수불현황 Excel 업로드 API
 * POST /api/production-sheet-upload
 *
 * 입고/출고 → INSERT (코드에서 중복 병합. DB unique 제약 없음)
 * 재고 → inventory_stock_snapshot upsert (product_code 기준 덮어쓰기)
 * 채널 비어있으면 'general' 기본값
 */

import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { InboundRow, OutboundRow, RawProductRow, StockSnapshotRow } from "@/lib/productionSheetParser";

const TABLE_PRODUCTS = "inventory_products";
const TABLE_INBOUND = "inventory_inbound";
const TABLE_OUTBOUND = "inventory_outbound";
const TABLE_CURRENT = "inventory_current_products";
const TABLE_SNAPSHOT = "inventory_stock_snapshot";

/** 채널 비어있으면 'general' (과거 데이터·누락 방지) */
function ensureChannel(ch: string | undefined | null): "coupang" | "general" {
  const s = String(ch ?? "").trim().toLowerCase();
  if (s.includes("쿠팡") || s === "coupang") return "coupang";
  return "general";
}

/** 당월(현재 월) 첫날~마지막날. 당월 이전 데이터는 수정하지 않음 */
function getCurrentMonthRange(): [string, string] {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const first = `${y}-${String(m).padStart(2, "0")}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const last = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return [first, last];
}

/** 해당 기간 데이터 삭제 (당월만 삭제 시 사용) */
async function deleteByDateRange(
  supabase: SupabaseClient,
  table: string,
  dateCol: string,
  dateFrom: string,
  dateTo: string
): Promise<boolean> {
  try {
    await supabase.from(table).delete().gte(dateCol, dateFrom).lte(dateCol, dateTo);
    return true;
  } catch (e) {
    console.error(`[production-sheet-upload] ${table} 기간 삭제 실패:`, e);
    return false;
  }
}

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 503 }
    );
  }

  let body: {
    rawProducts?: RawProductRow[];
    inbound: InboundRow[];
    outbound: OutboundRow[];
    stockSnapshot: StockSnapshotRow[];
    currentProductCodes: string[];
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { rawProducts = [], inbound = [], outbound = [], stockSnapshot = [], currentProductCodes = [] } = body;

  const supabase = createClient(url, key);
  const BATCH = 300;

  try {
    // 0. Python integrated_sync와 동일 순서: rawdata → inventory_products
    if (rawProducts.length > 0) {
      const rawRows = rawProducts.map((p) => ({
        product_code: p.product_code,
        product_name: p.product_name,
        unit_cost: p.unit_cost,
        category: p.category,
        pack_size: p.pack_size,
      }));
      for (let i = 0; i < rawRows.length; i += BATCH) {
        const batch = rawRows.slice(i, i + BATCH);
        const { error } = await supabase.from(TABLE_PRODUCTS).upsert(batch, { onConflict: "product_code" });
        if (error) {
          return NextResponse.json(
            { error: `제품(rawdata) 등록 실패: ${error.message}` },
            { status: 500 }
          );
        }
      }
    }

    // 0b. FK 보장: 입고/출고/재고에 등장하는 product_code가 없으면 최소 행 추가 (Python과 동일)
    const allCodes = new Set<string>();
    const nameByCode = new Map<string, string>();
    for (const r of inbound) {
      allCodes.add(r.product_code);
      if (r.product_name) nameByCode.set(r.product_code, r.product_name);
    }
    for (const r of outbound) {
      allCodes.add(r.product_code);
      if (r.product_name && !nameByCode.has(r.product_code)) nameByCode.set(r.product_code, r.product_name);
    }
    for (const r of stockSnapshot) allCodes.add(r.product_code);
    if (allCodes.size > 0) {
      const codesList = Array.from(allCodes);
      const existingCodes = new Set<string>();
      for (let i = 0; i < codesList.length; i += BATCH) {
        const batch = codesList.slice(i, i + BATCH);
        const res = await supabase.from(TABLE_PRODUCTS).select("product_code").in("product_code", batch);
        for (const r of res.data ?? []) {
          existingCodes.add((r as { product_code: string }).product_code);
        }
      }
      const missing = codesList.filter((c) => !existingCodes.has(c));
      if (missing.length > 0) {
        const toInsert = missing.map((c) => ({
          product_code: c,
          product_name: nameByCode.get(c) ?? c,
          unit_cost: 0,
          category: "기타",
          pack_size: 1,
        }));
        for (let i = 0; i < toInsert.length; i += BATCH) {
          const batch = toInsert.slice(i, i + BATCH);
          const { error } = await supabase.from(TABLE_PRODUCTS).upsert(batch, { onConflict: "product_code" });
          if (error) {
            return NextResponse.json(
              { error: `제품(FK보장) 등록 실패: ${error.message}` },
              { status: 500 }
            );
          }
        }
      }
    }

    // 1. 입고: Python과 동일 - 해당 기간 삭제 후 upsert (product_code+inbound_date)
    let inboundInserted = 0;
    if (inbound.length > 0) {
      const merged = new Map<
        string,
        {
          product_code: string;
          product_name?: string;
          quantity: number;
          inbound_date: string;
          category?: string;
          pack_size?: number;
          dest_warehouse?: string;
          unit_price?: number;
          total_price?: number;
        }
      >();
      for (const r of inbound) {
        const k = `${r.product_code}|${r.inbound_date}`;
        const existing = merged.get(k);
        if (existing) {
          existing.quantity += r.quantity;
          if (r.category && !existing.category) existing.category = r.category;
          if (r.product_name && !existing.product_name) existing.product_name = r.product_name;
          if (r.dest_warehouse && !existing.dest_warehouse) existing.dest_warehouse = r.dest_warehouse;
          if ((r.unit_price ?? 0) > 0 && (existing.unit_price ?? 0) <= 0) existing.unit_price = r.unit_price;
          if ((r.total_price ?? 0) > 0 && (existing.total_price ?? 0) <= 0) existing.total_price = r.total_price;
        } else {
          merged.set(k, {
            product_code: r.product_code,
            quantity: r.quantity,
            inbound_date: r.inbound_date,
            ...(r.category && { category: r.category }),
            ...(r.product_name && { product_name: r.product_name }),
            ...(r.pack_size && r.pack_size > 0 && { pack_size: r.pack_size }),
            ...(r.dest_warehouse && { dest_warehouse: r.dest_warehouse }),
            ...(r.unit_price != null && r.unit_price > 0 && { unit_price: r.unit_price }),
            ...(r.total_price != null && r.total_price > 0 && { total_price: r.total_price }),
          });
        }
      }
      const [monthStart, monthEnd] = getCurrentMonthRange();
      await deleteByDateRange(supabase, TABLE_INBOUND, "inbound_date", monthStart, monthEnd);
      const rows = Array.from(merged.values()).filter((r) => {
        const d = r.inbound_date.slice(0, 10);
        return d >= monthStart && d <= monthEnd;
      });
      const codes = [...new Set(rows.map((r) => r.product_code))];
      const costRes = await supabase.from(TABLE_PRODUCTS).select("product_code,unit_cost").in("product_code", codes);
      const costMap = new Map<string, number>();
      for (const r of costRes.data ?? []) {
        const p = r as { product_code: string; unit_cost?: number };
        if ((p.unit_cost ?? 0) > 0) costMap.set(p.product_code, p.unit_cost!);
      }
      const rowsWithCost = rows.map((r) => {
        let up = r.unit_price ?? 0;
        let tp = r.total_price ?? 0;
        if (up <= 0) up = costMap.get(r.product_code) ?? 0;
        if (tp <= 0 && up > 0) tp = Math.round(r.quantity * up * 100) / 100;
        return { ...r, unit_price: up, total_price: tp };
      });
      for (let i = 0; i < rowsWithCost.length; i += BATCH) {
        const batch = rowsWithCost.slice(i, i + BATCH);
        const { error } = await supabase.from(TABLE_INBOUND).upsert(batch, { onConflict: "product_code,inbound_date" });
        if (error) {
          return NextResponse.json(
            { error: `입고 저장 실패: ${error.message}` },
            { status: 500 }
          );
        }
        inboundInserted += batch.length;
      }
    }

    // 2. 재고: Python과 동일 - 전체 truncate 후 INSERT (inbound 다음, 출고 전)
    let stockInserted = 0;
    if (stockSnapshot.length > 0) {
      const today = new Date().toISOString().slice(0, 10);
      const codes = Array.from(new Set(stockSnapshot.map((s) => s.product_code)));
      const [existingSnap, productsInfo] = await Promise.all([
        supabase.from(TABLE_SNAPSHOT).select("product_code,unit_cost").in("product_code", codes),
        supabase.from(TABLE_PRODUCTS).select("product_code,unit_cost,product_name,category,group_name").in("product_code", codes),
      ]);
      const costByCode = new Map<string, number>();
      const productInfoByCode = new Map<string, { product_name?: string; category?: string }>();
      for (const r of existingSnap.data ?? []) {
        const c = (r as { product_code: string; unit_cost: number }).unit_cost;
        if (c != null && c > 0) costByCode.set((r as { product_code: string }).product_code, c);
      }
      for (const r of productsInfo.data ?? []) {
        const p = r as { product_code: string; unit_cost?: number; product_name?: string; category?: string; group_name?: string };
        if ((p.unit_cost ?? 0) > 0 && !costByCode.has(p.product_code)) costByCode.set(p.product_code, p.unit_cost!);
        const name = (p.product_name ?? "").trim() || (p.product_code ?? "");
        const cat = (p.category ?? p.group_name ?? "").trim() || "기타";
        if (name || cat) productInfoByCode.set(p.product_code, { product_name: name || undefined, category: cat || undefined });
      }
      const snapshotRows = stockSnapshot.map((s) => {
        let cost = s.unit_cost ?? 0;
        if (cost <= 0) cost = costByCode.get(s.product_code) ?? 0;
        const totalPrice = (s.total_price ?? 0) > 0 ? s.total_price! : s.quantity * cost;
        const info = productInfoByCode.get(s.product_code);
        return {
          product_code: s.product_code,
          dest_warehouse: s.dest_warehouse ?? "",
          product_name: info?.product_name ?? s.product_code,
          category: info?.category ?? "기타",
          quantity: s.quantity,
          unit_cost: Math.round(cost * 100) / 100,
          total_price: Math.round(totalPrice * 100) / 100,
          snapshot_date: today,
        };
      });
      // RPC가 당월만 삭제 후 INSERT. 당월 이전 데이터는 유지
      const { error: rpcError } = await supabase.rpc("replace_stock_snapshot", {
        p_rows: snapshotRows,
        p_snapshot_date: today,
      });
      if (rpcError) {
        return NextResponse.json(
          { error: `재고 스냅샷 저장 실패: ${rpcError.message}` },
          { status: 500 }
        );
      }
      stockInserted = snapshotRows.length;
    }

    // 3. 출고: Python과 동일 - 해당 기간 삭제 후 upsert (product_code+outbound_date+sales_channel)
    let outboundInserted = 0;
    if (outbound.length > 0) {
      const merged = new Map<
        string,
        {
          product_code: string;
          product_name?: string;
          quantity: number;
          outbound_date: string;
          sales_channel: "coupang" | "general";
          category?: string;
          pack_size?: number;
          dest_warehouse?: string;
          unit_price?: number;
          total_price?: number;
        }
      >();
      for (const r of outbound) {
        const ch = ensureChannel(r.sales_channel);
        const k = `${r.product_code}|${r.outbound_date}|${ch}`;
        const existing = merged.get(k);
        if (existing) {
          existing.quantity += r.quantity;
          if (r.category && !existing.category) existing.category = r.category;
          if (r.product_name && !existing.product_name) existing.product_name = r.product_name;
          if (r.dest_warehouse && !existing.dest_warehouse) existing.dest_warehouse = r.dest_warehouse;
          if ((r.unit_price ?? 0) > 0 && (existing.unit_price ?? 0) <= 0) existing.unit_price = r.unit_price;
          if ((r.total_price ?? 0) > 0 && (existing.total_price ?? 0) <= 0) existing.total_price = r.total_price;
        } else {
          merged.set(k, {
            product_code: r.product_code,
            quantity: r.quantity,
            outbound_date: r.outbound_date,
            sales_channel: ch,
            ...(r.category && { category: r.category }),
            ...(r.product_name && { product_name: r.product_name }),
            ...(r.pack_size && r.pack_size > 0 && { pack_size: r.pack_size }),
            ...(r.dest_warehouse && { dest_warehouse: r.dest_warehouse }),
            ...(r.unit_price != null && r.unit_price > 0 && { unit_price: r.unit_price }),
            ...(r.total_price != null && r.total_price > 0 && { total_price: r.total_price }),
          });
        }
      }
      const [monthStart, monthEnd] = getCurrentMonthRange();
      await deleteByDateRange(supabase, TABLE_OUTBOUND, "outbound_date", monthStart, monthEnd);
      const rows = Array.from(merged.values()).filter((r) => {
        const d = r.outbound_date.slice(0, 10);
        return d >= monthStart && d <= monthEnd;
      });
      const codes = [...new Set(rows.map((r) => r.product_code))];
      const costRes = await supabase.from(TABLE_PRODUCTS).select("product_code,unit_cost").in("product_code", codes);
      const costMap = new Map<string, number>();
      for (const r of costRes.data ?? []) {
        const p = r as { product_code: string; unit_cost?: number };
        if ((p.unit_cost ?? 0) > 0) costMap.set(p.product_code, p.unit_cost!);
      }
      const rowsWithCost = rows.map((r) => {
        let up = r.unit_price ?? 0;
        let tp = r.total_price ?? 0;
        if (up <= 0) up = costMap.get(r.product_code) ?? 0;
        if (tp <= 0 && up > 0) tp = Math.round(r.quantity * up * 100) / 100;
        return { ...r, unit_price: up, total_price: tp };
      });
      for (let i = 0; i < rowsWithCost.length; i += BATCH) {
        const batch = rowsWithCost.slice(i, i + BATCH);
        const { error } = await supabase.from(TABLE_OUTBOUND).upsert(batch, { onConflict: "product_code,outbound_date,sales_channel" });
        if (error) {
          return NextResponse.json(
            { error: `출고 저장 실패: ${error.message}` },
            { status: 500 }
          );
        }
        outboundInserted += batch.length;
      }
    }

    // 4. inventory_current_products 동기화 (Python과 동일)
    if (currentProductCodes.length > 0) {
      const currentRows = currentProductCodes.map((c) => ({ product_code: c }));
      for (let i = 0; i < currentRows.length; i += BATCH) {
        const batch = currentRows.slice(i, i + BATCH);
        const { error } = await supabase
          .from(TABLE_CURRENT)
          .upsert(batch, { onConflict: "product_code" });
        if (error) {
          return NextResponse.json(
            { error: `현재 품목 동기화 실패: ${error.message}` },
            { status: 500 }
          );
        }
      }
    }

    return NextResponse.json({
      success: true,
      rawProducts: rawProducts.length,
      inbound: { inserted: inboundInserted },
      stockSnapshot: stockInserted,
      outbound: { inserted: outboundInserted },
      currentProducts: currentProductCodes.length,
    });
  } catch (e) {
    console.error("[production-sheet-upload] error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
