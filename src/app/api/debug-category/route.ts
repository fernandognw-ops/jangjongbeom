/**
 * GET /api/debug-category
 * 품목별 category 매핑 상태 확인용
 */
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: "Supabase 미설정" }, { status: 500 });
  }
  const supabase = createClient(url, key);

  const [snapRes, prodRes] = await Promise.all([
    supabase.from("inventory_stock_snapshot").select("product_code,category").limit(100),
    supabase.from("inventory_products").select("product_code,category,group_name").limit(100),
  ]);

  const snapshot = (snapRes.data ?? []) as { product_code: string; category?: string }[];
  const products = (prodRes.data ?? []) as { product_code: string; category?: string; group_name?: string }[];

  const byCode = new Map<string, { snapshot?: string; product?: string; group_name?: string }>();
  for (const r of snapshot) {
    const c = String(r.product_code ?? "").trim();
    if (c) byCode.set(c, { ...byCode.get(c), snapshot: String(r.category ?? "").trim() });
  }
  for (const p of products) {
    const c = String(p.product_code ?? "").trim();
    if (c) byCode.set(c, { ...byCode.get(c), product: String(p.category ?? "").trim(), group_name: String(p.group_name ?? "").trim() });
  }

  const sample = Array.from(byCode.entries()).slice(0, 20).map(([code, v]) => ({
    product_code: code,
    snapshot_category: v.snapshot || "(없음)",
    product_category: v.product || "(없음)",
    group_name: v.group_name || "(없음)",
  }));

  return NextResponse.json({
    snapshot_count: snapshot.length,
    products_count: products.length,
    sample,
  });
}
