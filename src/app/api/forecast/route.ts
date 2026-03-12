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

/** 임시로 예측 비활성화 (true = 빈 데이터만 반환) */
const SKIP_FORECAST = true;

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
  try {
    // 임시로 빈 배열을 반환하여 에러를 방지하고 대시보드를 살립니다.
    return NextResponse.json([]);
  } catch (error) {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
