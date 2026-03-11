/**
 * AI 기반 출고량·생산량 예측 API
 * GET /api/forecast
 *
 * 과거 1년(25년~26년) 수불 데이터 기반 향후 3개월 출고량 예측
 * 단순 회귀·이동평균 활용
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeCode } from "@/lib/inventoryApi";
import type { InventoryProduct } from "@/lib/inventoryApi";

const TABLE_PRODUCTS = "inventory_products";
const TABLE_OUTBOUND = "inventory_outbound";

type MonthlyOutbound = Record<string, number>;

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

/** 월별 출고량 배열 → 향후 3개월 예측 (회귀 + 이동평균 혼합) */
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
    const dateFrom = oneYearAgo.toISOString().slice(0, 10);

    const [productsRes, outboundRes] = await Promise.all([
      supabase.from(TABLE_PRODUCTS).select("product_code, product_name, group_name, lead_time_days").order("product_code"),
      supabase
        .from(TABLE_OUTBOUND)
        .select("product_code, quantity, outbound_date")
        .gte("outbound_date", dateFrom)
        .order("outbound_date")
        .limit(100000),
    ]);

    if (productsRes.error || outboundRes.error) {
      return NextResponse.json(
        { error: productsRes.error?.message ?? outboundRes.error?.message },
        { status: 500 }
      );
    }

    const products = (productsRes.data ?? []) as InventoryProduct[];
    const outbound = (outboundRes.data ?? []) as {
      product_code: string;
      quantity: number;
      outbound_date: string;
    }[];

    const codeToProduct = new Map<string, InventoryProduct>();
    for (const p of products) {
      const k = normalizeCode(p.product_code) || String(p.product_code).trim();
      if (!codeToProduct.has(k)) codeToProduct.set(k, p);
      codeToProduct.set(String(p.product_code).trim(), p);
    }

    const monthlyByCode: Record<string, MonthlyOutbound> = {};
    for (const o of outbound) {
      const code = normalizeCode(o.product_code) || String(o.product_code).trim();
      const month = (o.outbound_date ?? "").slice(0, 7);
      if (!month) continue;
      if (!monthlyByCode[code]) monthlyByCode[code] = {};
      monthlyByCode[code][month] =
        (monthlyByCode[code][month] ?? 0) + Number(o.quantity ?? 0);
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

      productForecasts.push({
        product_code: code,
        product_name: p?.product_name ?? code,
        group_name: p?.group_name ?? "생활용품",
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
      product_forecasts: productForecasts.slice(0, 50),
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
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
