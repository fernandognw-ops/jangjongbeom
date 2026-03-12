/**
 * Supabase 재고 테이블 진단 API
 * GET /api/inventory-diag
 * 각 테이블 row 수 및 샘플 데이터 반환
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeCode } from "@/lib/inventoryApi";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return NextResponse.json({
      ok: false,
      error: "Supabase 미설정",
      hint: ".env.local에 NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY 확인",
    });
  }

  const projectRef = url?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1] ?? "unknown";

  const supabase = createClient(url, key);
  try {
    const [currentRes, snapshotRes, inboundRes, outboundRes, productsRes] = await Promise.all([
      supabase.from("inventory_current_products").select("product_code"),
      supabase.from("inventory_stock_snapshot").select("product_code,quantity,category,snapshot_date"),
      supabase.from("inventory_inbound").select("product_code,inbound_date,quantity"),
      supabase.from("inventory_outbound").select("product_code,outbound_date,quantity"),
      supabase.from("inventory_products").select("product_code,unit_cost"),
    ]);

    const currentCount = currentRes.data?.length ?? 0;
    const snapshotData = (snapshotRes.data ?? []) as { product_code?: string; quantity: number; category?: string; snapshot_date?: string }[];
    const categoryCount: Record<string, number> = {};
    for (const r of snapshotData) {
      const c = String(r.category ?? "").trim() || "기타";
      categoryCount[c] = (categoryCount[c] ?? 0) + 1;
    }
    const productsData = (productsRes.data ?? []) as { product_code?: string; unit_cost?: number }[];
    const codeToCost = new Map<string, number>();
    for (const p of productsData) {
      const code = normalizeCode(p.product_code) || String(p.product_code ?? "").trim();
      if (code && (p.unit_cost ?? 0) > 0) codeToCost.set(code, Number(p.unit_cost));
    }
    const inboundCount = inboundRes.data?.length ?? 0;
    const outboundCount = outboundRes.data?.length ?? 0;
    const totalValue = snapshotData.reduce(
      (s, r) => {
        const code = normalizeCode(r.product_code) || String(r.product_code ?? "").trim();
        return s + (r.quantity ?? 0) * (codeToCost.get(code) ?? codeToCost.get(String(r.product_code ?? "").trim()) ?? 0);
      },
      0
    );

    return NextResponse.json({
      ok: true,
      supabaseProject: projectRef,
      hint:
        snapshotData.length === 0 && inboundCount === 0 && outboundCount === 0
          ? "데이터 없음. bulk-upload 실행 후 새로고침. 배포 URL 사용 시 Vercel env의 Supabase가 .env.local과 다를 수 있음."
          : undefined,
      tables: {
        inventory_current_products: currentCount,
        inventory_products: productsRes.data?.length ?? 0,
        inventory_stock_snapshot: snapshotData.length,
        inventory_inbound: inboundCount,
        inventory_outbound: outboundCount,
      },
      totalValue: Math.round(totalValue),
      categoryByCount: categoryCount,
      sample: {
        stock_snapshot: snapshotRes.data?.slice(0, 5).map((r: { product_code: string; quantity: number; category?: string }) => ({
          product_code: r.product_code,
          quantity: r.quantity,
          category: r.category,
        })),
        inbound: inboundRes.data?.slice(0, 3),
        outbound: outboundRes.data?.slice(0, 3),
      },
      errors: {
        current: currentRes.error?.message,
        snapshot: snapshotRes.error?.message,
        inbound: inboundRes.error?.message,
        outbound: outboundRes.error?.message,
      },
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
