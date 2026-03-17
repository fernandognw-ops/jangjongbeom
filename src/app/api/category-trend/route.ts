/**
 * 카테고리별 월별 추세 API
 * GET /api/category-trend
 * - inventory_outbound quantity 합산 (판매량)
 * - inventory_inbound quantity 합산 (입고량)
 * - 카테고리: inventory_stock_snapshot.category(품목구분) 기준, product_code별
 */
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { normalizeCode, normalizeCategory } from "@/lib/inventoryApi";
import { fetchNaverSearchTrendMonthly, NAVER_CATEGORIES } from "@/lib/naverSearchTrend";

const emptyResponse = {
  months: [] as string[],
  categories: [] as string[],
  chartData: [] as Record<string, string | number>[],
  naverSearchTrend: {} as Record<string, Record<string, number>>,
  momRates: {} as Record<string, Record<string, number | null>>,
  monthlyTotals: {} as Record<string, { outbound: number; inbound: number; outboundValue: number; inboundValue: number; outboundCoupang: number; outboundGeneral: number; outboundValueCoupang: number; outboundValueGeneral: number; inboundByWarehouse: Record<string, number> }>,
  momIndicators: {
    outbound: null as number | null,
    inbound: null as number | null,
    thisMonthOutbound: 0,
    thisMonthInbound: 0,
    thisMonthOutboundValue: 0,
    thisMonthInboundValue: 0,
    thisMonthOutboundCoupang: 0,
    thisMonthOutboundGeneral: 0,
    thisMonthInboundByWarehouse: {} as Record<string, number>,
  },
};

const PAGE_SIZE = 2000;

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

/** 카테고리 정규화: 캡슐세제 사은품 → 캡슐사은품 */
function normalizeCategoryName(cat: string): string {
  const s = String(cat ?? "").trim();
  if (s === "캡슐세제 사은품" || (s.includes("캡슐세제") && s.includes("사은품"))) return "캡슐사은품";
  return s;
}

/** 표시용 카테고리 순서 (기타 제외) - 표준 카테고리만 표시 */
const CATEGORY_ORDER = ["마스크", "캡슐세제", "섬유유연제", "액상세제", "생활용품", "캡슐사은품"];

/** 품목구분 → 표준 카테고리만 반환 (매핑 불가 시 null) */
function toStandardCategory(cat: string): string | null {
  const n = normalizeCategory(normalizeCategoryName(cat));
  if (!n || !CATEGORY_ORDER.includes(n)) return null;
  return n;
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
    // 최근 14개월 기간으로 조회 (25년 3월~ 데이터 포함)
    const fourteenMonthsAgo = new Date(year, month - 13, 1);
    const dateFrom = `${fourteenMonthsAgo.getFullYear()}-${String(fourteenMonthsAgo.getMonth() + 1).padStart(2, "0")}-01`;

    const [productsRes, outbound, inbound, snapshotRes, naverMonthly] = await Promise.all([
      supabase.from("inventory_products").select("product_code,product_name,unit_cost,category").limit(5000),
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
      supabase.from("inventory_stock_snapshot").select("product_code,category,snapshot_date,quantity,unit_cost,total_price").limit(10000),
      fetchNaverSearchTrendMonthly(),
    ]);

    /** product_code → category(품목구분): inventory_stock_snapshot 우선 */
    const codeToCategory = new Map<string, string>();
    const snapData = (snapshotRes.data ?? []) as { product_code: string; category?: string; snapshot_date?: string }[];
    const byCodeDate = new Map<string, { category: string; date: string }>();
    for (const row of snapData) {
      const code = normalizeCode(row.product_code) || String(row.product_code ?? "").trim();
      const cat = String(row.category ?? "").trim();
      const date = (row.snapshot_date ?? "").slice(0, 10);
      if (!code) continue;
      const existing = byCodeDate.get(code);
      const useCat = cat || (existing?.category ?? "");
      if (!existing || date >= existing.date) byCodeDate.set(code, { category: useCat, date });
    }
    for (const [code, v] of byCodeDate.entries()) {
      if (v.category) codeToCategory.set(code, v.category);
    }

    const products = (productsRes.data ?? []) as { product_code: string; product_name?: string; unit_cost?: number; category?: string; group_name?: string }[];
    const codeToCost = new Map<string, number>();
    const categoriesSet = new Set<string>();
    for (const p of products) {
      const k = normalizeCode(p.product_code) || String(p.product_code).trim();
      const fromProduct = String(p.category ?? p.group_name ?? "").trim();
      const catFromSnapshot = codeToCategory.get(k) ?? codeToCategory.get(String(p.product_code).trim());
      const group = (fromProduct && fromProduct !== "기타") ? fromProduct : (catFromSnapshot || "기타");
      if (!codeToCategory.has(k)) codeToCategory.set(k, group);
      if (!codeToCategory.has(String(p.product_code).trim())) codeToCategory.set(String(p.product_code).trim(), group);
      const std = toStandardCategory(group);
      if (std) categoriesSet.add(std);
      const c = Number(p.unit_cost ?? 0);
      if (c > 0 && c <= 500_000) {
        codeToCost.set(k, c);
        codeToCost.set(String(p.product_code).trim(), c);
      }
    }
    const byMonthCategory: Record<string, Record<string, number>> = {};

    // 그래프·전월대비: 아웃바운드(실제 출고)만 사용 (인바운드 제외), 표준 카테고리만
    for (const o of outbound) {
      const m = (o.outbound_date ?? "").slice(0, 7);
      if (!m) continue;
      if (!byMonthCategory[m]) byMonthCategory[m] = {};
      const rowCat = (o.category ?? "").trim();
      let cat =
        (rowCat && rowCat !== "기타") ? rowCat :
        codeToCategory.get(normalizeCode(o.product_code) || "") ||
        codeToCategory.get(String(o.product_code).trim()) ||
        "";
      if (cat === "기타") continue;
      const std = toStandardCategory(cat);
      if (!std) continue;
      categoriesSet.add(std);
      byMonthCategory[m][std] = (byMonthCategory[m][std] ?? 0) + Number(o.quantity ?? 0);
    }

    const ordered = [...categoriesSet];
    const finalCategories = CATEGORY_ORDER.filter((c) => ordered.includes(c));

    // 최근 14개월 슬롯 고정 (25년 3월~ 데이터 포함)
    const fourteenMonthsSlots: string[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(year, month - i, 1);
      fourteenMonthsSlots.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    const months = fourteenMonthsSlots;

    /** 월간 평균 검색 지수 (월별 출고량과 1:1 대응) */
    const naverByMonth: Record<string, Record<string, number>> = {};
    for (const [kw, data] of Object.entries(naverMonthly ?? {})) {
      for (const d of data) {
        const m = (d.period ?? "").slice(0, 7);
        if (!m || m.length < 7) continue;
        if (!naverByMonth[m]) naverByMonth[m] = {};
        const ratio = typeof d.ratio === "number" ? d.ratio : parseFloat(String(d.ratio ?? 0)) || 0;
        naverByMonth[m][`naver_${kw}`] = Math.min(100, Math.max(0, ratio));
      }
    }

    const chartData = months.map((month) => {
      const row: Record<string, string | number> = { month };
      const cats = byMonthCategory[month] ?? {};
      for (const c of finalCategories) row[c] = cats[c] ?? 0;
      const naverRow = naverByMonth[month] ?? {};
      for (const kw of NAVER_CATEGORIES) {
        if (!finalCategories.includes(kw)) continue;
        const v = naverRow[`naver_${kw}`];
        row[`naver_${kw}`] = typeof v === "number" ? Math.min(100, Math.max(0, v)) : 0;
      }
      return row;
    });

    const monthlyTotals: Record<string, { outbound: number; inbound: number; outboundValue: number; inboundValue: number; outboundCoupang: number; outboundGeneral: number; outboundValueCoupang: number; outboundValueGeneral: number; inboundByWarehouse: Record<string, number> }> = {};
    for (const m of months) monthlyTotals[m] = { outbound: 0, inbound: 0, outboundValue: 0, inboundValue: 0, outboundCoupang: 0, outboundGeneral: 0, outboundValueCoupang: 0, outboundValueGeneral: 0, inboundByWarehouse: {} };
    for (const o of outbound) {
      const m = (o.outbound_date ?? "").slice(0, 7);
      if (!monthlyTotals[m]) continue;
      const qty = Number(o.quantity ?? 0);
      const codeKey = normalizeCode(o.product_code) || String(o.product_code).trim();
      const cost = codeToCost.get(codeKey) ?? 0;
      const val = qty * cost;
      monthlyTotals[m].outbound += qty;
      monthlyTotals[m].outboundValue += val;
      if (isCoupangChannel(o.sales_channel)) {
        monthlyTotals[m].outboundCoupang += qty;
        monthlyTotals[m].outboundValueCoupang += val;
      } else {
        monthlyTotals[m].outboundGeneral += qty;
        monthlyTotals[m].outboundValueGeneral += val;
      }
    }
    for (const i of inbound) {
      const m = (i.inbound_date ?? "").slice(0, 7);
      if (!monthlyTotals[m]) continue;
      const qty = Number(i.quantity ?? 0);
      const codeKey = normalizeCode(i.product_code) || String(i.product_code).trim();
      const cost = codeToCost.get(codeKey) ?? 0;
      monthlyTotals[m].inbound += qty;
      monthlyTotals[m].inboundValue += qty * cost;
      const wh = String(i.dest_warehouse ?? "").trim() || "미지정";
      monthlyTotals[m].inboundByWarehouse[wh] = (monthlyTotals[m].inboundByWarehouse[wh] ?? 0) + qty;
    }

    const byMonthCategoryInboundValue: Record<string, Record<string, number>> = {};
    const byMonthCategoryOutboundValue: Record<string, Record<string, number>> = {};
    for (const m of months) {
      byMonthCategoryInboundValue[m] = {};
      byMonthCategoryOutboundValue[m] = {};
      for (const c of finalCategories) {
        byMonthCategoryInboundValue[m][c] = 0;
        byMonthCategoryOutboundValue[m][c] = 0;
      }
    }
    for (const o of outbound) {
      const m = (o.outbound_date ?? "").slice(0, 7);
      if (!byMonthCategoryOutboundValue[m]) continue;
      const rowCat = (o.category ?? "").trim();
      let cat = (rowCat && rowCat !== "기타") ? rowCat : codeToCategory.get(normalizeCode(o.product_code) || "") || codeToCategory.get(String(o.product_code).trim()) || "";
      if (cat === "기타") continue;
      const std = toStandardCategory(cat);
      if (!std || !finalCategories.includes(std)) continue;
      const qty = Number(o.quantity ?? 0);
      const cost = codeToCost.get(normalizeCode(o.product_code) || "") ?? codeToCost.get(String(o.product_code).trim()) ?? 0;
      byMonthCategoryOutboundValue[m][std] = (byMonthCategoryOutboundValue[m][std] ?? 0) + qty * cost;
    }
    for (const i of inbound) {
      const m = (i.inbound_date ?? "").slice(0, 7);
      if (!byMonthCategoryInboundValue[m]) continue;
      const rowCat = (i.category ?? "").trim();
      let cat = (rowCat && rowCat !== "기타") ? rowCat : codeToCategory.get(normalizeCode(i.product_code) || "") || codeToCategory.get(String(i.product_code).trim()) || "";
      if (cat === "기타") continue;
      const std = toStandardCategory(cat);
      if (!std || !finalCategories.includes(std)) continue;
      const qty = Number(i.quantity ?? 0);
      const cost = codeToCost.get(normalizeCode(i.product_code) || "") ?? codeToCost.get(String(i.product_code).trim()) ?? 0;
      byMonthCategoryInboundValue[m][std] = (byMonthCategoryInboundValue[m][std] ?? 0) + qty * cost;
    }

    // 월별 재고 자산: 당월말 기준. 현재월=최신 snapshot, 과거월=역산(다음월말 - 다음월 입고 + 다음월 출고)
    const thisMonthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
    const snapRows = (snapshotRes.data ?? []) as { product_code: string; category?: string; snapshot_date?: string; quantity?: number; unit_cost?: number; total_price?: number }[];
    const latestSnapshotDate = snapRows.length > 0
      ? snapRows.reduce((max, r) => {
          const d = (r.snapshot_date ?? "").slice(0, 10);
          return d > max ? d : max;
        }, "")
      : "";
    const valueByCategoryFromSnapshot: Record<string, number> = {};
    for (const c of finalCategories) valueByCategoryFromSnapshot[c] = 0;
    for (const row of snapRows) {
      const rowDate = (row.snapshot_date ?? "").slice(0, 10);
      if (rowDate !== latestSnapshotDate) continue;
      const code = normalizeCode(row.product_code) || String(row.product_code ?? "").trim();
      let cat = String(row.category ?? "").trim();
      if (!cat || cat === "기타") cat = codeToCategory.get(code) ?? codeToCategory.get(String(row.product_code ?? "").trim()) ?? "";
      if (!cat) cat = "기타";
      const std = toStandardCategory(cat);
      if (!std || !finalCategories.includes(std)) continue;
      const qty = Number(row.quantity ?? 0);
      const cost = Number(row.unit_cost ?? 0);
      const totalPrice = Number(row.total_price ?? 0);
      const val = totalPrice > 0 ? totalPrice : qty * (cost > 0 ? cost : (codeToCost.get(code) ?? codeToCost.get(String(row.product_code ?? "").trim()) ?? 0));
      valueByCategoryFromSnapshot[std] = (valueByCategoryFromSnapshot[std] ?? 0) + val;
    }
    for (const c of finalCategories) {
      valueByCategoryFromSnapshot[c] = Math.round(valueByCategoryFromSnapshot[c] ?? 0);
    }

    const monthlyValueByCategory: Record<string, Record<string, number>> = {};
    for (let i = months.length - 1; i >= 0; i--) {
      const m = months[i];
      if (m === thisMonthKey) {
        monthlyValueByCategory[m] = { ...valueByCategoryFromSnapshot };
      } else {
        const nextIdx = i + 1;
        const nextMonth = months[nextIdx];
        const prevVal = nextMonth ? monthlyValueByCategory[nextMonth] ?? {} : {};
        monthlyValueByCategory[m] = {};
        for (const c of finalCategories) {
          const nextVal = prevVal[c] ?? 0;
          const inVal = byMonthCategoryInboundValue[nextMonth]?.[c] ?? 0;
          const outVal = byMonthCategoryOutboundValue[nextMonth]?.[c] ?? 0;
          monthlyValueByCategory[m][c] = Math.round(nextVal - inVal + outVal);
        }
      }
    }

    /** 증감률 표시 상한: ±50% (비정상 수치 방지) */
    const MOM_RATE_CLAMP = 50;
    const clampMomRate = (r: number) => Math.max(-MOM_RATE_CLAMP, Math.min(MOM_RATE_CLAMP, r));

    const momRates: Record<string, Record<string, number | null>> = {};
    for (const cat of finalCategories) {
      momRates[cat] = {};
      for (let i = 0; i < months.length; i++) {
        const curr = (byMonthCategory[months[i]] ?? {})[cat] ?? 0;
        if (i === 0) momRates[cat][months[i]] = null;
        else {
          const prev = (byMonthCategory[months[i - 1]] ?? {})[cat] ?? 0;
          const raw = prev > 0 ? Math.round(((curr - prev) / prev) * 1000) / 10 : (curr > 0 ? 100 : 0);
          momRates[cat][months[i]] = clampMomRate(raw);
        }
      }
    }

    const prevMonthKey = month === 0 ? `${year - 1}-12` : `${year}-${String(month).padStart(2, "0")}`;
    const thisOut = monthlyTotals[thisMonthKey]?.outbound ?? 0;
    const thisIn = monthlyTotals[thisMonthKey]?.inbound ?? 0;
    const prevOut = monthlyTotals[prevMonthKey]?.outbound ?? 0;
    const prevIn = monthlyTotals[prevMonthKey]?.inbound ?? 0;

    const naverSearchTrend: Record<string, Record<string, number>> = {};
    for (const [kw, data] of Object.entries(naverMonthly ?? {})) {
      for (const d of data) {
        const m = d.period.slice(0, 7);
        if (!naverSearchTrend[m]) naverSearchTrend[m] = {};
        naverSearchTrend[m][kw] = d.ratio;
      }
    }

    return NextResponse.json(
      {
        months,
        categories: finalCategories,
        chartData,
        naverSearchTrend,
        momRates,
        monthlyTotals,
        monthlyValueByCategory,
        momIndicators: {
        outbound: prevOut > 0 ? clampMomRate(Math.round(((thisOut - prevOut) / prevOut) * 1000) / 10) : null,
        inbound: prevIn > 0 ? clampMomRate(Math.round(((thisIn - prevIn) / prevIn) * 1000) / 10) : null,
        thisMonthOutbound: thisOut,
        thisMonthInbound: thisIn,
        thisMonthOutboundValue: Math.round(monthlyTotals[thisMonthKey]?.outboundValue ?? 0),
        thisMonthInboundValue: Math.round(monthlyTotals[thisMonthKey]?.inboundValue ?? 0),
        thisMonthOutboundCoupang: monthlyTotals[thisMonthKey]?.outboundCoupang ?? 0,
        thisMonthOutboundGeneral: monthlyTotals[thisMonthKey]?.outboundGeneral ?? 0,
        thisMonthInboundByWarehouse: monthlyTotals[thisMonthKey]?.inboundByWarehouse ?? {},
      },
    },
    {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0", "Pragma": "no-cache" },
    }
    );
  } catch (e) {
    console.error("[category-trend] error:", e);
    return NextResponse.json(
      { ...emptyResponse, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 200 }
    );
  }
}
