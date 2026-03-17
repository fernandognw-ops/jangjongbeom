/**
 * 수요 예측 API
 * GET /api/forecast
 *
 * [정밀 산술 + 네이버 검색 트렌드]
 * 1. M0: Run-rate
 * 2. 추세: M0 - 3개월평균
 * 3. M1~M3: (3개월평균+추세) × (1 + 검색지수_변화율) 선형 연장, 검색가중치 최대 1.3배
 * 4. Clamping: 하한 0, 상한 직전달×2
 */

import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { normalizeCode, normalizeCategory } from "@/lib/inventoryApi";
import { fetchNaverSearchTrend, fetchNaverSearchTrendMonthly, NAVER_CATEGORIES } from "@/lib/naverSearchTrend";

const TABLE_PRODUCTS = "inventory_products";
const TABLE_OUTBOUND = "inventory_outbound";
const PAGE_SIZE = 5000;

type MonthlyOutbound = Record<string, number>;

function toNumber(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function fetchAllOutbound(
  supabase: SupabaseClient,
  dateFrom: string
): Promise<{ product_code: string; quantity: number; outbound_date: string }[]> {
  const all: { product_code: string; quantity: number; outbound_date: string }[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from(TABLE_OUTBOUND)
      .select("product_code,quantity,outbound_date")
      .gte("outbound_date", dateFrom)
      .order("outbound_date", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) break;
    const rows = (data ?? []) as { product_code: string; quantity: number; outbound_date: string }[];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

function getThisMonthKey(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

function getPrevMonthKey(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number) as [number, number];
  if (m <= 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** Clamp: 하한 0, 상한 직전 대비 2배 이하 */
function clamp(value: number, prev: number): number {
  const floor = 0;
  const ceiling = prev > 0 ? prev * 2 : Number.MAX_SAFE_INTEGER;
  return Math.max(floor, Math.min(Math.round(value), ceiling));
}

/** 3개월 이동평균 (당월 제외) */
function movingAvg3(monthly: Record<string, number>, months: string[], thisMonthKey: string): number {
  const last = months[months.length - 1] ?? "";
  const exclude = last === thisMonthKey;
  const forAvg = exclude ? months.slice(0, -1).slice(-3) : months.slice(-3);
  if (forAvg.length === 0) return 0;
  const sum = forAvg.reduce((s, m) => s + (monthly[m] ?? 0), 0);
  return Math.max(0, Math.round(sum / forAvg.length));
}

/** Run-rate: (누적/경과일수) × 당월총일수 */
function runRate(cumulative: number, elapsedDays: number, daysInMonth: number): number {
  if (elapsedDays <= 0) return 0;
  return Math.max(0, Math.round((cumulative / elapsedDays) * daysInMonth));
}

export const dynamic = "force-dynamic";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return NextResponse.json(
      {
        forecast_this_month_label: "",
        forecast_month_labels: ["M1", "M2", "M3"],
        product_forecasts: [],
        category_forecast: {},
        summary: { total_products_forecasted: 0, total_production_needed_3m: 0 },
        error: "Supabase not configured",
      },
      { status: 200 }
    );
  }

  const supabase = createClient(url, key);

  try {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const dayOfMonth = now.getDate();
    const elapsedDays = Math.max(1, dayOfMonth);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const thisMonthKey = getThisMonthKey(year, month);
    const todayStr = `${thisMonthKey}-${String(dayOfMonth).padStart(2, "0")}`;

    const dateFrom = new Date(year, month - 24, 1).toISOString().slice(0, 10);

    const [productsRes, outboundRows, searchTrend, naverMonthly] = await Promise.all([
      supabase.from(TABLE_PRODUCTS).select("product_code,product_name,category,group_name").limit(10000),
      fetchAllOutbound(supabase, dateFrom),
      fetchNaverSearchTrend(),
      fetchNaverSearchTrendMonthly(),
    ]);
    const searchMultiplierByCategory = searchTrend.byCategory ?? {};

    const naverIndexByMonth: Record<string, Record<string, number>> = {};
    for (const [kw, data] of Object.entries(naverMonthly ?? {})) {
      for (const d of data) {
        const m = (d.period ?? "").slice(0, 7);
        if (!m || m.length < 7) continue;
        if (!naverIndexByMonth[m]) naverIndexByMonth[m] = {};
        naverIndexByMonth[m][kw] = typeof d.ratio === "number" ? d.ratio : parseFloat(String(d.ratio ?? 0)) || 0;
      }
    }

    const codeToProduct = new Map<string, { name: string; category: string }>();
    for (const p of (productsRes.data ?? []) as Array<{ product_code?: string; product_name?: string; category?: string; group_name?: string }>) {
      const code = String(p.product_code ?? "").trim();
      const cat = String(p.category ?? p.group_name ?? "기타").trim() || "기타";
      codeToProduct.set(code, {
        name: String(p.product_name ?? p.product_code ?? code).trim() || code,
        category: normalizeCategory(cat) || cat,
      });
    }

    const byProductMonth: Record<string, MonthlyOutbound> = {};
    const byProductCumulative: Record<string, number> = {};

    for (const row of outboundRows) {
      const code = String(row.product_code ?? "").trim();
      const dateStr = (row.outbound_date ?? "").slice(0, 10);
      const m = dateStr.slice(0, 7);
      if (!code || !m) continue;
      if (!byProductMonth[code]) byProductMonth[code] = {};
      byProductMonth[code][m] = (byProductMonth[code][m] ?? 0) + toNumber(row.quantity);
      if (m === thisMonthKey && dateStr <= todayStr) {
        byProductCumulative[code] = (byProductCumulative[code] ?? 0) + toNumber(row.quantity);
      }
    }

    const orderedMonths = [...new Set(Object.values(byProductMonth).flatMap((o) => Object.keys(o)))].sort();

    const categoryMonthly: Record<string, Record<string, number>> = {};
    for (const [code, monthly] of Object.entries(byProductMonth)) {
      const prod = codeToProduct.get(code) ?? codeToProduct.get(normalizeCode(code) ?? "") ?? { name: code, category: "기타" };
      const cat = prod.category;
      if (!categoryMonthly[cat]) categoryMonthly[cat] = {};
      for (const [m, val] of Object.entries(monthly)) {
        categoryMonthly[cat][m] = (categoryMonthly[cat][m] ?? 0) + val;
      }
    }

    const stableCategories = new Set<string>();
    for (const cat of Object.keys(categoryMonthly)) {
      let count = 0;
      for (let i = orderedMonths.length - 1; i >= 0; i--) {
        if ((categoryMonthly[cat][orderedMonths[i]] ?? 0) > 0) count++;
        else break;
      }
      if (count >= 3) stableCategories.add(cat);
    }

    const m1 = new Date(year, month + 1, 1);
    const m2 = new Date(year, month + 2, 1);
    const m3 = new Date(year, month + 3, 1);
    const next3MonthKeys: [string, string, string] = [
      `${m1.getFullYear()}-${String(m1.getMonth() + 1).padStart(2, "0")}`,
      `${m2.getFullYear()}-${String(m2.getMonth() + 1).padStart(2, "0")}`,
      `${m3.getFullYear()}-${String(m3.getMonth() + 1).padStart(2, "0")}`,
    ];

    const productForecasts: Array<{
      product_code: string;
      product_name: string;
      group_name: string;
      lead_time_days: number;
      past_12m_total: number;
      forecast_this_month: number;
      forecast_month1: number;
      forecast_month2: number;
      forecast_month3: number;
      production_needed: number;
      yoy_pct: number;
      last_year_base: number;
    }> = [];
    const categoryForecast: Record<string, {
      forecast_this_month: number;
      forecast_month1: number;
      forecast_month2: number;
      forecast_month3: number;
      production_needed: number;
      yoy_pct: number;
      last_year_base: number;
    }> = {};

    for (const [code, monthly] of Object.entries(byProductMonth)) {
      const months = orderedMonths.filter((m) => monthly[m] != null);
      if (months.length < 2) continue;

      const prod = codeToProduct.get(code) ?? codeToProduct.get(normalizeCode(code) ?? "") ?? { name: code, category: "기타" };
      if (!stableCategories.has(prod.category)) continue;

      const avg3 = movingAvg3(monthly, months, thisMonthKey);
      const lastMonthKey = getPrevMonthKey(thisMonthKey);
      const lastMonthQty = monthly[lastMonthKey] ?? 0;

      const cumulative = byProductCumulative[code] ?? 0;
      const m0Raw = cumulative > 0 ? runRate(cumulative, elapsedDays, daysInMonth) : 0;
      const f0 = clamp(m0Raw, lastMonthQty);

      const trend = f0 - avg3;
      const searchChangeRate = searchMultiplierByCategory[prod.category] ?? 0;
      const searchMult = 1 + searchChangeRate;

      const currIdx = naverIndexByMonth[thisMonthKey]?.[prod.category] ?? 0;
      const prevIdx = naverIndexByMonth[lastMonthKey]?.[prod.category] ?? 0;
      const hasNaverData = NAVER_CATEGORIES.includes(prod.category) && (currIdx > 0 || prevIdx > 0);
      const indexMaintainOrRise = prevIdx <= 0 || currIdx >= prevIdx;
      const indexBoost = hasNaverData && indexMaintainOrRise ? 1.05 : 1;

      const baseF1 = avg3 + trend;
      const baseF2 = baseF1 + trend;
      const baseF3 = baseF2 + trend;

      const f1 = clamp(baseF1 * searchMult * indexBoost, lastMonthQty);
      const f2 = clamp(baseF2 * searchMult * indexBoost, f1);
      const f3 = clamp(baseF3 * searchMult * indexBoost, f2);

      const lastYearKeys = [thisMonthKey, ...next3MonthKeys].map((k) => {
        const [y, m] = k.split("-").map(Number) as [number, number];
        return `${y - 1}-${String(m).padStart(2, "0")}`;
      });
      const lastYearBase = lastYearKeys.reduce((s, k) => s + (monthly[k] ?? 0), 0);
      const past12m = months.reduce((s, m) => s + (monthly[m] ?? 0), 0);
      const prodNeeded = Math.max(0, f1 + f2 + f3);

      productForecasts.push({
        product_code: code,
        product_name: prod.name,
        group_name: prod.category,
        lead_time_days: 7,
        past_12m_total: past12m,
        forecast_this_month: f0,
        forecast_month1: f1,
        forecast_month2: f2,
        forecast_month3: f3,
        production_needed: prodNeeded,
        yoy_pct: 0,
        last_year_base: lastYearBase,
      });

      const cat = prod.category;
      if (!categoryForecast[cat]) {
        categoryForecast[cat] = { forecast_this_month: 0, forecast_month1: 0, forecast_month2: 0, forecast_month3: 0, production_needed: 0, yoy_pct: 0, last_year_base: 0 };
      }
      categoryForecast[cat].forecast_this_month += f0;
      categoryForecast[cat].forecast_month1 += f1;
      categoryForecast[cat].forecast_month2 += f2;
      categoryForecast[cat].forecast_month3 += f3;
      categoryForecast[cat].production_needed += prodNeeded;
      categoryForecast[cat].last_year_base += lastYearBase;
    }

    const excludedCategories = Object.keys(categoryMonthly).filter((c) => !stableCategories.has(c));

    return NextResponse.json({
      forecast_this_month_label: thisMonthKey,
      forecast_month_labels: next3MonthKeys,
      product_forecasts: productForecasts.sort((a, b) => b.production_needed - a.production_needed),
      category_forecast: categoryForecast,
      category_avg_yoy: {} as Record<string, number>,
      summary: {
        total_products_forecasted: productForecasts.length,
        total_production_needed_3m: productForecasts.reduce((s, p) => s + p.production_needed, 0),
        excluded_categories: excludedCategories,
      },
    });
  } catch (e) {
    console.error("[forecast] error:", e);
    return NextResponse.json(
      {
        forecast_this_month_label: "",
        forecast_month_labels: ["M1", "M2", "M3"],
        product_forecasts: [],
        category_forecast: {},
        summary: { total_products_forecasted: 0, total_production_needed_3m: 0 },
        error: e instanceof Error ? e.message : "Unknown error",
      },
      { status: 200 }
    );
  }
}
