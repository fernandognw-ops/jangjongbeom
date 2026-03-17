/**
 * 생산수불현황 Excel 업로드 API
 * POST /api/production-sheet-upload
 *
 * 입고/출고 → INSERT (코드에서 중복 병합. DB unique 제약 없음)
 * 재고 → inventory_stock_snapshot upsert (product_code 기준 덮어쓰기)
 * 채널 비어있으면 'general' 기본값
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { InboundRow, OutboundRow, StockSnapshotRow } from "@/lib/productionSheetParser";

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

  const { inbound = [], outbound = [], stockSnapshot = [], currentProductCodes = [] } = body;

  const supabase = createClient(url, key);
  const BATCH = 300;

  try {
    // 0. 품목코드 수집 → inventory_products에 없는 코드 추가
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
        group_name: "생활용품",
        category: "생활용품",
        unit_cost: 0,
        pack_size: 1,
      }));
      for (let i = 0; i < newProducts.length; i += BATCH) {
        const batch = newProducts.slice(i, i + BATCH);
        const { error } = await supabase.from(TABLE_PRODUCTS).upsert(batch, { onConflict: "product_code" });
        if (error) {
          return NextResponse.json(
            { error: `제품 등록 실패: ${error.message}` },
            { status: 500 }
          );
        }
      }
    }

    // 1. 입고 UPSERT (동일 product_code+inbound_date → 업로드 값으로 덮어쓰기)
    let inboundInserted = 0;
    if (inbound.length > 0) {
      const merged = new Map<string, { product_code: string; quantity: number; inbound_date: string; category?: string }>();
      for (const r of inbound) {
        const k = `${r.product_code}|${r.inbound_date}`;
        const existing = merged.get(k);
        if (existing) {
          existing.quantity += r.quantity;
          if (r.category && !existing.category) existing.category = r.category;
        } else {
          merged.set(k, { product_code: r.product_code, quantity: r.quantity, inbound_date: r.inbound_date, ...(r.category && { category: r.category }) });
        }
      }
      const rows = Array.from(merged.values());
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
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

    // 2. 출고 UPSERT (동일 product_code+outbound_date+sales_channel → 업로드 값으로 덮어쓰기)
    let outboundInserted = 0;
    if (outbound.length > 0) {
      const merged = new Map<string, { product_code: string; quantity: number; outbound_date: string; sales_channel: "coupang" | "general"; category?: string }>();
      for (const r of outbound) {
        const ch = ensureChannel(r.sales_channel);
        const k = `${r.product_code}|${r.outbound_date}|${ch}`;
        const existing = merged.get(k);
        if (existing) {
          existing.quantity += r.quantity;
          if (r.category && !existing.category) existing.category = r.category;
        } else {
          merged.set(k, { product_code: r.product_code, quantity: r.quantity, outbound_date: r.outbound_date, sales_channel: ch, ...(r.category && { category: r.category }) });
        }
      }
      const rows = Array.from(merged.values());
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
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

    // 4. inventory_current_products 동기화 (재고 시트 품목)
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

    // 5. inventory_stock_snapshot 전체 교체 (DELETE + INSERT 트랜잭션)
    if (stockSnapshot.length > 0) {
      const today = new Date().toISOString().slice(0, 10);
      const codes = Array.from(new Set(stockSnapshot.map((s) => s.product_code)));
      const [existingSnap, productsCost] = await Promise.all([
        supabase.from(TABLE_SNAPSHOT).select("product_code,unit_cost").in("product_code", codes),
        supabase.from(TABLE_PRODUCTS).select("product_code,unit_cost").in("product_code", codes),
      ]);
      const costByCode = new Map<string, number>();
      for (const r of existingSnap.data ?? []) {
        const c = (r as { product_code: string; unit_cost: number }).unit_cost;
        if (c != null && c > 0) costByCode.set((r as { product_code: string }).product_code, c);
      }
      for (const r of productsCost.data ?? []) {
        const p = r as { product_code: string; unit_cost: number };
        if ((p.unit_cost ?? 0) > 0 && !costByCode.has(p.product_code)) costByCode.set(p.product_code, p.unit_cost);
      }
      const snapshotRows = stockSnapshot.map((s) => {
        let cost = s.unit_cost ?? 0;
        if (cost <= 0) cost = costByCode.get(s.product_code) ?? 0;
        return {
          product_code: s.product_code,
          dest_warehouse: "",
          quantity: s.quantity,
          unit_cost: cost,
          snapshot_date: today,
        };
      });
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
    }

    return NextResponse.json({
      success: true,
      inbound: { inserted: inboundInserted },
      outbound: { inserted: outboundInserted },
      stockSnapshot: stockSnapshot.length,
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
