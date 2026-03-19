/**
 * 재고 스냅샷 전용 API (경량)
 * GET /api/inventory/stock
 * inventory_stock_snapshot 수량만 반환 (product_code → quantity)
 */
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeCode } from "@/lib/inventoryApi";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return NextResponse.json(
      { stockByProduct: {}, error: "supabase_not_configured" },
      { status: 200 }
    );
  }

  const supabase = createClient(url, key);
  const { data, error } = await supabase
    .from("inventory_stock_snapshot")
    .select("product_code,quantity,snapshot_date")
    .limit(10000);

  if (error) {
    return NextResponse.json(
      { stockByProduct: {}, error: error.message },
      { status: 200 }
    );
  }

  const stockByProduct: Record<string, number> = {};
  const byCode = new Map<string, { qty: number; date: string }>();
  for (const row of data ?? []) {
    const r = row as { product_code?: unknown; quantity?: unknown; snapshot_date?: string };
    const code = normalizeCode(r.product_code) || String(r.product_code ?? "").trim();
    const qty = Number(r.quantity) || 0;
    const date = (r.snapshot_date ?? "").slice(0, 10);
    const existing = byCode.get(code);
    if (!existing || date > existing.date) {
      byCode.set(code, { qty, date });
    }
  }
  for (const [code, v] of byCode.entries()) {
    stockByProduct[code] = v.qty;
    stockByProduct[String(code).trim()] = v.qty;
  }

  return NextResponse.json({ stockByProduct });
}
