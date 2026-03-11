/**
 * 카테고리별 월별 추세 API
 * GET /api/category-trend
 * - inventory_outbound quantity 합산 (판매량)
 * - inventory_inbound quantity 합산 (입고량)
 * - 카테고리: inventory_products.group_name 컬럼 기준 (DB 데이터 그대로 사용)
 */

import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { normalizeCode } from "@/lib/inventoryApi";

const emptyResponse = {
  months: [] as string[],
  categories: [] as string[],
  chartData: [] as Record<string, string | number>[],
  momRates: {} as Record<string, Record<string, number | null>>,
  monthlyTotals: {} as Record<string, { outbound: number; inbound: number; outboundValue: number; inboundValue: number; outboundCoupang: number; outboundGeneral: number; inboundCoupang: number; inboundGeneral: number }>,
  momIndicators: {
    outbound: null as number | null,
    inbound: null as number | null,
    thisMonthOutbound: 0,
    thisMonthInbound: 0,
    thisMonthOutboundValue: 0,
    thisMonthInboundValue: 0,
    thisMonthOutboundCoupang: 0,
    thisMonthOutboundGeneral: 0,
    thisMonthInboundCoupang: 0,
    thisMonthInboundGeneral: 0,
  },
};

const PAGE_SIZE = 1000;

async function fetchAllRows<T>(
  supabase: SupabaseClient,
  table: string,
  select: string,
  gteCol: string,
  gteVal: string
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .gte(gteCol, gteVal)
      .order(gteCol, { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) break;
    const rows = (data ?? []) as T[];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

/** sales_channel이 쿠팡(coupang)인지 판별. DB에 'coupang' 또는 '쿠팡' 저장 가능 */
function isCoupangChannel(ch: string | null | undefined): boolean {
  const s = String(ch ?? "").trim().toLowerCase();
  return s === "coupang" || s === "쿠팡" || s.includes("쿠팡");
}

/** dest_warehouse(입고처)가 쿠팡 입고인지. 테이칼튼, 테이칼튼 1공장 → 쿠팡 */
function isCoupangInbound(dest: string | null | undefined): boolean {
  const s = String(dest ?? "").trim();
  return s.includes("테이칼튼");
}

/** dest_warehouse(입고처)가 일반 입고인지. 제이에스 → 일반 */
function isGeneralInbound(dest: string | null | undefined): boolean {
  const s = String(dest ?? "").trim();
  return s.includes("제이에스");
}

export async function GET() {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return NextResponse.json(emptyResponse, { status: 200 });

    const supabase = createClient(url, key);

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const dateFrom = `${year - 2}-01-01`;

    const [productsRes, outbound, inbound] = await Promise.all([
      supabase.from("inventory_products").select("product_code,product_name,unit_cost,group_name").limit(5000),
      fetchAllRows<{ product_code: string; quantity: number; outbound_date: string; sales_channel?: string; product_name?: string; category?: string }>(
        supabase,
        "inventory_outbound",
        "product_code,quantity,outbound_date,sales_channel,product_name,category",
        "outbound_date",
        dateFrom
      ),
      fetchAllRows<{ product_code: string; quantity: number; inbound_date: string; dest_warehouse?: string; category?: string }>(
        supabase,
        "inventory_inbound",
        "product_code,quantity,inbound_date,dest_warehouse,category",
        "inbound_date",
        dateFrom
      ),
    ]);

    const products = (productsRes.data ?? []) as { product_code: string; product_name?: string; unit_cost?: number; group_name?: string }[];
    const codeToGroup = new Map<string, string>();
    const codeToCost = new Map<string, number>();
    const categoriesSet = new Set<string>(["생활용품"]);
    for (const p of products) {
      const k = normalizeCode(p.product_code) || String(p.product_code).trim();
      const raw = String(p.group_name ?? "").trim();
      const group = raw && raw !== "기타" ? raw : "생활용품";
      codeToGroup.set(k, group);
      codeToGroup.set(String(p.product_code).trim(), group);
      categoriesSet.add(group);
      const c = Number(p.unit_cost ?? 0);
      if (c > 0 && c <= 500_000) {
        codeToCost.set(k, c);
        codeToCost.set(String(p.product_code).trim(), c);
      }
    }
    const byMonthCategory: Record<string, Record<string, number>> = {};
    const monthsSet = new Set<string>();

    for (const o of outbound) {
      const m = (o.outbound_date ?? "").slice(0, 7);
      if (!m) continue;
      monthsSet.add(m);
      if (!byMonthCategory[m]) byMonthCategory[m] = {};
      const rowCat = (o.category ?? "").trim();
      const cat =
        (rowCat && rowCat !== "기타") ? rowCat :
        codeToGroup.get(normalizeCode(o.product_code) || "") ||
        codeToGroup.get(String(o.product_code).trim()) ||
        "생활용품";
      if (!categoriesSet.has(cat)) categoriesSet.add(cat);
      byMonthCategory[m][cat] = (byMonthCategory[m][cat] ?? 0) + Number(o.quantity ?? 0);
    }
    for (const i of inbound) {
      const m = (i.inbound_date ?? "").slice(0, 7);
      if (!m) continue;
      monthsSet.add(m);
      if (!byMonthCategory[m]) byMonthCategory[m] = {};
    }

    const months = Array.from(monthsSet).sort();
    const finalCategories = Array.from(categoriesSet).sort();

    const chartData = months.map((month) => {
      const row: Record<string, string | number> = { month };
      const cats = byMonthCategory[month] ?? {};
      for (const c of finalCategories) row[c] = cats[c] ?? 0;
      return row;
    });

    const monthlyTotals: Record<string, { outbound: number; inbound: number; outboundValue: number; inboundValue: number; outboundCoupang: number; outboundGeneral: number; inboundCoupang: number; inboundGeneral: number }> = {};
    for (const m of months) monthlyTotals[m] = { outbound: 0, inbound: 0, outboundValue: 0, inboundValue: 0, outboundCoupang: 0, outboundGeneral: 0, inboundCoupang: 0, inboundGeneral: 0 };
    for (const o of outbound) {
      const m = (o.outbound_date ?? "").slice(0, 7);
      if (!monthlyTotals[m]) continue;
      const qty = Number(o.quantity ?? 0);
      const codeKey = normalizeCode(o.product_code) || String(o.product_code).trim();
      const cost = codeToCost.get(codeKey) ?? 0;
      monthlyTotals[m].outbound += qty;
      monthlyTotals[m].outboundValue += qty * cost;
      if (isCoupangChannel(o.sales_channel)) monthlyTotals[m].outboundCoupang += qty;
      else monthlyTotals[m].outboundGeneral += qty;
    }
    for (const i of inbound) {
      const m = (i.inbound_date ?? "").slice(0, 7);
      if (!monthlyTotals[m]) continue;
      const qty = Number(i.quantity ?? 0);
      const codeKey = normalizeCode(i.product_code) || String(i.product_code).trim();
      const cost = codeToCost.get(codeKey) ?? 0;
      monthlyTotals[m].inbound += qty;
      monthlyTotals[m].inboundValue += qty * cost;
      if (isCoupangInbound(i.dest_warehouse)) monthlyTotals[m].inboundCoupang += qty;
      else if (isGeneralInbound(i.dest_warehouse)) monthlyTotals[m].inboundGeneral += qty;
      else monthlyTotals[m].inboundGeneral += qty;
    }

    const momRates: Record<string, Record<string, number | null>> = {};
    for (const cat of finalCategories) {
      momRates[cat] = {};
      for (let i = 0; i < months.length; i++) {
        const curr = (byMonthCategory[months[i]] ?? {})[cat] ?? 0;
        if (i === 0) momRates[cat][months[i]] = null;
        else {
          const prev = (byMonthCategory[months[i - 1]] ?? {})[cat] ?? 0;
          momRates[cat][months[i]] = prev > 0 ? Math.round(((curr - prev) / prev) * 1000) / 10 : (curr > 0 ? 100 : 0);
        }
      }
    }

    const thisMonthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
    const prevMonthKey = month === 0 ? `${year - 1}-12` : `${year}-${String(month).padStart(2, "0")}`;
    const thisOut = monthlyTotals[thisMonthKey]?.outbound ?? 0;
    const thisIn = monthlyTotals[thisMonthKey]?.inbound ?? 0;
    const prevOut = monthlyTotals[prevMonthKey]?.outbound ?? 0;
    const prevIn = monthlyTotals[prevMonthKey]?.inbound ?? 0;

    return NextResponse.json({
      months,
      categories: finalCategories,
      chartData,
      momRates,
      monthlyTotals,
      momIndicators: {
        outbound: prevOut > 0 ? Math.round(((thisOut - prevOut) / prevOut) * 1000) / 10 : null,
        inbound: prevIn > 0 ? Math.round(((thisIn - prevIn) / prevIn) * 1000) / 10 : null,
        thisMonthOutbound: thisOut,
        thisMonthInbound: thisIn,
        thisMonthOutboundValue: Math.round(monthlyTotals[thisMonthKey]?.outboundValue ?? 0),
        thisMonthInboundValue: Math.round(monthlyTotals[thisMonthKey]?.inboundValue ?? 0),
        thisMonthOutboundCoupang: monthlyTotals[thisMonthKey]?.outboundCoupang ?? 0,
        thisMonthOutboundGeneral: monthlyTotals[thisMonthKey]?.outboundGeneral ?? 0,
        thisMonthInboundCoupang: monthlyTotals[thisMonthKey]?.inboundCoupang ?? 0,
        thisMonthInboundGeneral: monthlyTotals[thisMonthKey]?.inboundGeneral ?? 0,
      },
    });
  } catch {
    return NextResponse.json(emptyResponse, { status: 200 });
  }
}
