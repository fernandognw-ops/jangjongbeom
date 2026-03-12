/**
 * inventory_products.group_name → inventory_stock_snapshot.category 동기화
 * GET /api/inventory/sync-category
 * product_code 기준 1:1 매칭, snapshot에 category가 비어있을 때 채움
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeCode } from "@/lib/inventoryApi";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return NextResponse.json({ ok: false, error: "Supabase 미설정" }, { status: 503 });
  }

  const supabase = createClient(url, key);

  try {
    const [snapRes, prodRes] = await Promise.all([
      supabase.from("inventory_stock_snapshot").select("product_code,category"),
      supabase.from("inventory_products").select("product_code,category").order("product_code"),
    ]);

    const snapshotRows = (snapRes.data ?? []) as { product_code: string; category?: string }[];
    const productRows = (prodRes.data ?? []) as { product_code: string; group_name?: string; category?: string }[];

    const codeToCat = new Map<string, string>();
    for (const p of productRows) {
      const rawCode = String(p.product_code ?? "").trim();
      const code = normalizeCode(p.product_code) || rawCode;
      const cat = String(p.category ?? p.group_name ?? "").trim();
      if (!code || !cat || cat === "기타" || cat === "전체") continue;
      codeToCat.set(code, cat);
      codeToCat.set(rawCode, cat);
    }

    const toUpdate: { code: string; cat: string }[] = [];
    const seenCodes = new Set<string>();
    for (const row of snapshotRows) {
      const rawCode = String(row.product_code ?? "").trim();
      const code = normalizeCode(row.product_code) || rawCode;
      if (seenCodes.has(code)) continue;
      seenCodes.add(code);

      const existing = String(row.category ?? "").trim();
      if (existing && existing !== "기타" && existing !== "전체") continue;

      const cat = codeToCat.get(code) ?? codeToCat.get(rawCode);
      if (!cat) continue;

      toUpdate.push({ code: rawCode, cat });
    }

    let updated = 0;
    const BATCH = 20;
    for (let i = 0; i < toUpdate.length; i += BATCH) {
      const batch = toUpdate.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map(({ code, cat }) =>
          supabase.from("inventory_stock_snapshot").update({ category: cat }).eq("product_code", code)
        )
      );
      updated += results.filter((r) => !r.error).length;
    }

    return NextResponse.json({
      ok: true,
      updated,
      message: `inventory_stock_snapshot.category ${updated}건 업데이트 (inventory_products.group_name 기준)`,
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
