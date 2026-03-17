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
        sub_group: "",
        spec: "",
        unit_cost: 0,
        pack_size: 1,
        sales_channel: "general",
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

    // 1. 입고: date+dest_warehouse 일치 기존 삭제 후 INSERT
    let inboundInserted = 0;
    if (inbound.length > 0) {
      const dates = [...new Set(inbound.map((r) => r.inbound_date))];
      const warehouses = [...new Set(inbound.map((r) => r.dest_warehouse).filter(Boolean))] as string[];
      if (dates.length > 0) {
        let q = supabase.from(TABLE_INBOUND).delete().in("inbound_date", dates);
        if (warehouses.length > 0) {
          q = q.in("dest_warehouse", warehouses);
        }
        await q;
      }
      const merged = new Map<string, { product_code: string; quantity: number; inbound_date: string; dest_warehouse?: string; category?: string }>();
      for (const r of inbound) {
        const wh = r.dest_warehouse?.trim() || undefined;
        const k = `${r.product_code}|${r.inbound_date}`;
        const existing = merged.get(k);
        if (existing) {
          existing.quantity += r.quantity;
          if (r.category && !existing.category) existing.category = r.category;
          if (wh && !existing.dest_warehouse) existing.dest_warehouse = wh;
        } else {
          merged.set(k, { product_code: r.product_code, quantity: r.quantity, inbound_date: r.inbound_date, ...(wh && { dest_warehouse: wh }), ...(r.category && { category: r.category }) });
        }
      }
      const rows = Array.from(merged.values());
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        const { error } = await supabase.from(TABLE_INBOUND).insert(batch);
        if (error) {
          return NextResponse.json(
            { error: `입고 저장 실패: ${error.message}` },
            { status: 500 }
          );
        }
        inboundInserted += batch.length;
      }
    }

    // 2. 출고: date+dest_warehouse 일치 기존 삭제 후 INSERT
    let outboundInserted = 0;
    if (outbound.length > 0) {
      const dates = [...new Set(outbound.map((r) => r.outbound_date))];
      const warehouses = [...new Set(outbound.map((r) => r.dest_warehouse).filter(Boolean))] as string[];
      if (dates.length > 0) {
        let q = supabase.from(TABLE_OUTBOUND).delete().in("outbound_date", dates);
        if (warehouses.length > 0) {
          q = q.in("dest_warehouse", warehouses);
        }
        await q;
      }
      const merged = new Map<string, { product_code: string; quantity: number; outbound_date: string; sales_channel: "coupang" | "general"; dest_warehouse?: string; category?: string }>();
      for (const r of outbound) {
        const ch = ensureChannel(r.sales_channel);
        const wh = r.dest_warehouse?.trim() || undefined;
        const k = `${r.product_code}|${r.outbound_date}|${ch}`;
        const existing = merged.get(k);
        if (existing) {
          existing.quantity += r.quantity;
          if (r.category && !existing.category) existing.category = r.category;
          if (wh && !existing.dest_warehouse) existing.dest_warehouse = wh;
        } else {
          merged.set(k, { product_code: r.product_code, quantity: r.quantity, outbound_date: r.outbound_date, sales_channel: ch, ...(wh && { dest_warehouse: wh }), ...(r.category && { category: r.category }) });
        }
      }
      const rows = Array.from(merged.values());
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        const { error } = await supabase.from(TABLE_OUTBOUND).insert(batch);
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

    // 5. inventory_stock_snapshot: date+dest_warehouse 일치 기존 삭제 후 upsert
    if (stockSnapshot.length > 0) {
      const today = new Date().toISOString().slice(0, 10);
      const warehouses = [...new Set(stockSnapshot.map((s) => s.dest_warehouse).filter(Boolean))] as string[];
      const codes = Array.from(new Set(stockSnapshot.map((s) => s.product_code)));
      const [existingSnap, productsCost] = await Promise.all([
        supabase.from(TABLE_SNAPSHOT).select("product_code,dest_warehouse,unit_cost").in("product_code", codes),
        supabase.from(TABLE_PRODUCTS).select("product_code,unit_cost").in("product_code", codes),
      ]);
      const costByKey = new Map<string, number>();
      const costByCode = new Map<string, number>();
      for (const r of existingSnap.data ?? []) {
        const row = r as { product_code: string; dest_warehouse?: string; unit_cost: number };
        const key = `${row.product_code}|${(row.dest_warehouse ?? "").trim() || "제이에스"}`;
        if ((row.unit_cost ?? 0) > 0) costByKey.set(key, row.unit_cost);
      }
      for (const r of productsCost.data ?? []) {
        const p = r as { product_code: string; unit_cost: number };
        if ((p.unit_cost ?? 0) > 0) costByCode.set(p.product_code, p.unit_cost);
      }
      const snapshotRows = stockSnapshot.map((s) => {
        const wh = s.dest_warehouse?.trim() || "제이에스";
        let cost = s.unit_cost ?? 0;
        if (cost <= 0) cost = costByKey.get(`${s.product_code}|${wh}`) ?? costByCode.get(s.product_code) ?? 0;
        return {
          product_code: s.product_code,
          dest_warehouse: wh,
          quantity: s.quantity,
          unit_cost: cost,
          snapshot_date: today,
        };
      });
      if (warehouses.length > 0) {
        await supabase.from(TABLE_SNAPSHOT).delete().eq("snapshot_date", today).in("dest_warehouse", warehouses);
      } else {
        await supabase.from(TABLE_SNAPSHOT).delete().eq("snapshot_date", today);
      }
      for (let i = 0; i < snapshotRows.length; i += BATCH) {
        const batch = snapshotRows.slice(i, i + BATCH);
        const { error } = await supabase
          .from(TABLE_SNAPSHOT)
          .upsert(batch, { onConflict: "product_code,dest_warehouse" });
        if (error) {
          const errMsg = error.message.toLowerCase();
          if (errMsg.includes("product_code,dest_warehouse") || errMsg.includes("unique") || errMsg.includes("constraint")) {
            await supabase.from(TABLE_SNAPSHOT).delete().eq("snapshot_date", today);
            const fallback = new Map<string, { product_code: string; quantity: number; unit_cost: number; snapshot_date: string; dest_warehouse: string }>();
            for (const s of snapshotRows) {
              const code = s.product_code;
              const existing = fallback.get(code);
              if (existing) {
                existing.quantity += s.quantity;
              } else {
                fallback.set(code, { ...s, dest_warehouse: "제이에스" });
              }
            }
            const fallbackBatch = Array.from(fallback.values());
            const { error: err2 } = await supabase.from(TABLE_SNAPSHOT).upsert(fallbackBatch, { onConflict: "product_code" });
            if (err2) {
              return NextResponse.json(
                { error: `재고 스냅샷 저장 실패: ${err2.message}` },
                { status: 500 }
              );
            }
          } else {
            return NextResponse.json(
              { error: `재고 스냅샷 저장 실패: ${error.message}` },
              { status: 500 }
            );
          }
        }
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
