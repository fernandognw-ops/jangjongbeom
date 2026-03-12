/**
 * AI 기반 출고량·생산량 예측 API
 * GET /api/forecast
 *
 * 과거 1년(25년~26년) 수불 데이터 기반 향후 3개월 출고량 예측
 * 단순 회귀·이동평균 활용
 * - get_outbound_monthly_agg RPC 우선, 없으면 raw 출고 페이지네이션
 */

import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { normalizeCode, normalizeCategory } from "@/lib/inventoryApi";
import type { InventoryProduct } from "@/lib/inventoryApi";

const TABLE_PRODUCTS = "inventory_products";
const TABLE_OUTBOUND = "inventory_outbound";
const PAGE_SIZE = 5000;

type MonthlyOutbound = Record<string, number>;

function toNumber(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** raw 출고 전체 조회 (페이지네이션, RPC 없을 때 fallback) */
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

/** 선형 회귀: y = mx + b, x=월인덱스(0,1,2...) */
function linearRegression(
  values: number[]
): { slope: number; intercept: number; predict: (x: number) => number } {
  const n = values.length;
  if (n === 0) {
    return { slope: 0, intercept: 0, predict: () => 0 };
  }
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
  const intercept = (sumY - slope * sumX) / n;
  return {
    slope,
    intercept,
    predict: (x: number) => Math.max(0, Math.round(slope * x + intercept)),
  };
}

/** 월별 출고량 배열 → 향후 3개월 예측 (선형 회귀) */
function forecastNext3Months(monthlyValues: number[]): number[] {
  const valid = monthlyValues.filter((v) => Number.isFinite(v) && v >= 0);
  if (valid.length < 2) {
    const avg = valid.length === 1 ? valid[0] : 0;
    return [avg, avg, avg];
  }
  const { predict } = linearRegression(valid);
  const n = valid.length;
  const next3: number[] = [];
  for (let i = 0; i < 3; i++) {
    next3.push(predict(n + i));
  }
  return next3;
}

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 503 }
    );
  }

  const supabase = createClient(url, key);

  try {
    const now = new Date();
    const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), 1);
    const dateTo = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const dateFrom = oneYearAgo.toISOString().slice(0, 10);
    const dateToStr = dateTo.toISOString().slice(0, 10);

    const productsRes = await supabase.from(TABLE_PRODUCTS).select("product_code, product_name, category, group_name").order("product_code");
    if (productsRes.error) {
      console.error("[forecast] products error:", productsRes.error.message);
      return NextResponse.json(
        { error: productsRes.error.message, forecast_month_labels: [], product_forecasts: [], category_forecast: {}, summary: { total_products_forecasted: 0, total_production_needed_3m: 0 } },
        { status: 200 }
      );
    }

    const products = (productsRes.data ?? []) as InventoryProduct[];
    const codeToProduct = new Map<string, InventoryProduct>();
    for (const p of products) {
      const k = normalizeCode(p.product_code) || String(p.product_code).trim();
      if (!codeToProduct.has(k)) codeToProduct.set(k, p);
      codeToProduct.set(String(p.product_code).trim(), p);
    }

    let monthlyByCode: Record<string, MonthlyOutbound> = {};

    const aggRes = await supabase.rpc("get_outbound_monthly_agg", {
      p_date_from: dateFrom,
      p_date_to: dateToStr,
    });

    if (!aggRes.error && Array.isArray(aggRes.data)) {
      const aggRows = aggRes.data as { month_key: string; product_code: string; total_quantity: unknown }[];
      for (const r of aggRows) {
        const code = normalizeCode(r.product_code) || String(r.product_code ?? "").trim();
        const month = String(r.month_key ?? "").slice(0, 7);
        if (!month) continue;
        if (!monthlyByCode[code]) monthlyByCode[code] = {};
        monthlyByCode[code][month] =
          (monthlyByCode[code][month] ?? 0) + toNumber(r.total_quantity);
      }
    } else {
      if (aggRes.error) {
        console.warn("[forecast] RPC 없음, raw 출고 페이지네이션 사용:", aggRes.error.message);
      }
      const outbound = await fetchAllOutbound(supabase, dateFrom);
      for (const o of outbound) {
        const code = normalizeCode(o.product_code) || String(o.product_code ?? "").trim();
        const month = (o.outbound_date ?? "").slice(0, 7);
        if (!month) continue;
        if (!monthlyByCode[code]) monthlyByCode[code] = {};
        monthlyByCode[code][month] =
          (monthlyByCode[code][month] ?? 0) + toNumber(o.quantity);
      }
    }

    const allMonths = new Set<string>();
    for (const byMonth of Object.values(monthlyByCode)) {
      for (const m of Object.keys(byMonth)) allMonths.add(m);
    }
    const sortedMonths = Array.from(allMonths).sort();

    const productForecasts: {
      product_code: string;
      product_name: string;
      group_name: string;
      lead_time_days: number;
      past_12m_total: number;
      forecast_month1: number;
      forecast_month2: number;
      forecast_month3: number;
      production_needed: number;
    }[] = [];

    const DEFAULT_LEAD = 7;
    const forecastMonthLabels: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      forecastMonthLabels.push(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
      );
    }

    for (const [code, byMonth] of Object.entries(monthlyByCode)) {
      const p = codeToProduct.get(code) ?? products.find((x) => normalizeCode(x.product_code) === code || String(x.product_code).trim() === code);
      const values = sortedMonths.map((m) => byMonth[m] ?? 0);
      const pastTotal = values.reduce((a, b) => a + b, 0);
      if (pastTotal <= 0) continue;

      const [f1, f2, f3] = forecastNext3Months(values);
      const productionNeeded = f1 + f2 + f3;
      const leadTime = p?.lead_time_days ?? DEFAULT_LEAD;

      const rawCat = (p as { category?: string; group_name?: string })?.category ?? (p as { group_name?: string })?.group_name ?? "";
      const groupName = normalizeCategory(rawCat) || rawCat || "생활용품";
      productForecasts.push({
        product_code: code,
        product_name: p?.product_name ?? code,
        group_name: groupName,
        lead_time_days: leadTime,
        past_12m_total: pastTotal,
        forecast_month1: f1,
        forecast_month2: f2,
        forecast_month3: f3,
        production_needed: productionNeeded,
      });
    }

    productForecasts.sort((a, b) => b.production_needed - a.production_needed);

    const categoryForecast: Record<
      string,
      { forecast_month1: number; forecast_month2: number; forecast_month3: number; production_needed: number }
    > = {};
    for (const row of productForecasts) {
      const g = row.group_name ?? "생활용품";
      if (!categoryForecast[g]) {
        categoryForecast[g] = {
          forecast_month1: 0,
          forecast_month2: 0,
          forecast_month3: 0,
          production_needed: 0,
        };
      }
      categoryForecast[g].forecast_month1 += row.forecast_month1;
      categoryForecast[g].forecast_month2 += row.forecast_month2;
      categoryForecast[g].forecast_month3 += row.forecast_month3;
      categoryForecast[g].production_needed += row.production_needed;
    }

    return NextResponse.json({
      forecast_month_labels: forecastMonthLabels,
      product_forecasts: productForecasts,
      category_forecast: categoryForecast,
      summary: {
        total_products_forecasted: productForecasts.length,
        total_production_needed_3m: productForecasts.reduce(
          (a, b) => a + b.production_needed,
          0
        ),
      },
    });
  } catch (e) {
    console.error("[forecast] error:", e);
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "Unknown error",
        forecast_month_labels: [],
        product_forecasts: [],
        category_forecast: {},
        summary: { total_products_forecasted: 0, total_production_needed_3m: 0 },
      },
      { status: 200 }
    );
  }
}
