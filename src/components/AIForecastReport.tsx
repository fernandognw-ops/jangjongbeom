"use client";

import { useState, useEffect, useCallback } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

export interface ForecastItem {
  product_code: string;
  product_name: string;
  group_name: string;
  lead_time_days: number;
  past_12m_total: number;
  forecast_month1: number;
  forecast_month2: number;
  forecast_month3: number;
  production_needed: number;
}

export interface CategoryForecast {
  forecast_month1: number;
  forecast_month2: number;
  forecast_month3: number;
  production_needed: number;
}

export interface ForecastResponse {
  forecast_month_labels: string[];
  product_forecasts: ForecastItem[];
  category_forecast: Record<string, CategoryForecast>;
  summary: {
    total_products_forecasted: number;
    total_production_needed_3m: number;
  };
}

const CATEGORY_COLORS: Record<string, string> = {
  마스크: "#22d3ee",
  캡슐: "#a78bfa",
  원단: "#f472b6",
  액상: "#34d399",
  리빙: "#fbbf24",
  기타: "#94a3b8",
};

function getColorForCategory(cat: string, index: number): string {
  return (
    CATEGORY_COLORS[cat] ??
    ["#22d3ee", "#a78bfa", "#f472b6", "#34d399", "#fbbf24", "#94a3b8"][
      index % 6
    ]
  );
}

export function AIForecastReport() {
  const [data, setData] = useState<ForecastResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20_000);
    fetch("/api/forecast", { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(res.statusText);
        const json = await res.json();
        if (json?.error) throw new Error(json.error);
        return json as ForecastResponse;
      })
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch((e) => {
        if (!cancelled) {
          const msg =
            e instanceof Error && e.name === "AbortError"
              ? "요청 시간 초과. 새로고침 후 재시도하세요."
              : e instanceof Error
                ? e.message
                : "Failed to load";
          setError(msg);
        }
      })
      .finally(() => {
        clearTimeout(timeoutId);
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const cleanup = loadData();
    return () => (typeof cleanup === "function" ? cleanup() : undefined);
  }, [loadData]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-zinc-700 bg-zinc-900/50 p-8 text-center">
        <p className="text-zinc-500">AI 예측 분석 중…</p>
        <p className="mt-2 text-xs text-zinc-600">
          과거 1년 수불 데이터를 분석해 3개월 출고량을 예측합니다.
        </p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-6 text-center">
        <p className="text-red-400">{error ?? "데이터를 불러올 수 없습니다."}</p>
        <button
          type="button"
          onClick={() => loadData()}
          className="mt-3 rounded-lg bg-red-500/20 px-4 py-2 text-sm text-red-300 hover:bg-red-500/30"
        >
          다시 시도
        </button>
      </div>
    );
  }

  const labels = data.forecast_month_labels ?? ["M1", "M2", "M3"];
  const m1 = labels[0] ?? "M1";
  const m2 = labels[1] ?? "M2";
  const m3 = labels[2] ?? "M3";
  const categoryChartData = Object.entries(data.category_forecast ?? {}).map(
    ([cat, v]) => ({
      category: cat,
      [m1]: v.forecast_month1,
      [m2]: v.forecast_month2,
      [m3]: v.forecast_month3,
      production_needed: v.production_needed,
    })
  );

  const topProducts = (data.product_forecasts ?? []).slice(0, 15);

  return (
    <div className="min-w-0 space-y-6 overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900/80 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-white md:text-xl">
          AI 예측 보고
        </h2>
        <button
          type="button"
          onClick={() => loadData()}
          className="rounded-lg px-3 py-1.5 text-xs text-cyan-400 hover:bg-zinc-700 hover:text-white"
        >
          새로고침
        </button>
      </div>

      <p className="text-sm text-zinc-400">
        과거 1년(25년~26년) 수불 데이터 기반 선형 회귀 분석으로 향후 3개월
        출고량을 예측합니다.
      </p>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-cyan-500/40 bg-cyan-500/10 p-4">
          <div className="text-xs font-medium uppercase tracking-wider text-cyan-400">
            예측 품목 수
          </div>
          <div className="mt-1 text-xl font-bold tabular-nums text-white md:text-2xl">
            {data.summary?.total_products_forecasted ?? 0}건
          </div>
        </div>
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4">
          <div className="text-xs font-medium uppercase tracking-wider text-emerald-400">
            3개월 적정 생산 필요량
          </div>
          <div className="mt-1 text-xl font-bold tabular-nums text-white md:text-2xl">
            {(data.summary?.total_production_needed_3m ?? 0).toLocaleString()}개
          </div>
        </div>
      </div>

      {/* 카테고리별 예측 차트 */}
      {categoryChartData.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-zinc-300">
            카테고리별 3개월 예상 출고량
          </h3>
          <div className="h-64 w-full min-w-0 md:h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={categoryChartData}
                margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
                <XAxis
                  dataKey="category"
                  stroke="#71717a"
                  tick={{ fill: "#a1a1aa", fontSize: 11 }}
                />
                <YAxis
                  stroke="#71717a"
                  tick={{ fill: "#a1a1aa", fontSize: 11 }}
                  tickFormatter={(v) => v.toLocaleString()}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#18181b",
                    border: "1px solid #3f3f46",
                    borderRadius: "8px",
                  }}
                  formatter={(value) =>
                    typeof value === "number"
                      ? value.toLocaleString()
                      : String(value ?? "")
                  }
                />
                <Legend />
                {[m1, m2, m3].map((label, idx) => (
                  <Bar
                    key={label}
                    dataKey={label}
                    name={label}
                    fill={
                      ["#22d3ee", "#a78bfa", "#f472b6"][idx % 3] ?? "#94a3b8"
                    }
                    radius={[4, 4, 0, 0]}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* 품목별 상위 15건 적정 생산 필요량 */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-zinc-300">
          품목별 적정 생산 필요량 (상위 15건)
        </h3>
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-sm">
            <thead>
              <tr>
                <th className="border border-zinc-600 bg-zinc-800/80 px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">
                  품목
                </th>
                <th className="border border-zinc-600 bg-zinc-800/80 px-2 py-2 text-center text-xs font-medium text-zinc-400">
                  카테고리
                </th>
                <th className="border border-zinc-600 bg-zinc-800/80 px-2 py-2 text-right text-xs font-medium text-zinc-400">
                  {m1}
                </th>
                <th className="border border-zinc-600 bg-zinc-800/80 px-2 py-2 text-right text-xs font-medium text-zinc-400">
                  {m2}
                </th>
                <th className="border border-zinc-600 bg-zinc-800/80 px-2 py-2 text-right text-xs font-medium text-zinc-400">
                  {m3}
                </th>
                <th className="border border-zinc-600 bg-zinc-800/80 px-2 py-2 text-right text-xs font-medium text-zinc-400">
                  합계
                </th>
              </tr>
            </thead>
            <tbody>
              {topProducts.map((row, idx) => (
                <tr
                  key={row.product_code}
                  className="hover:bg-zinc-800/50"
                >
                  <td className="border border-zinc-700 px-3 py-2 font-medium text-zinc-200">
                    {row.product_name}
                  </td>
                  <td className="border border-zinc-700 px-2 py-2 text-center">
                    <span
                      className="inline-block rounded px-2 py-0.5 text-xs"
                      style={{
                        backgroundColor: `${getColorForCategory(row.group_name, idx)}30`,
                        color: getColorForCategory(row.group_name, idx),
                      }}
                    >
                      {row.group_name}
                    </span>
                  </td>
                  <td className="border border-zinc-700 px-2 py-2 text-right tabular-nums text-zinc-300">
                    {row.forecast_month1.toLocaleString()}
                  </td>
                  <td className="border border-zinc-700 px-2 py-2 text-right tabular-nums text-zinc-300">
                    {row.forecast_month2.toLocaleString()}
                  </td>
                  <td className="border border-zinc-700 px-2 py-2 text-right tabular-nums text-zinc-300">
                    {row.forecast_month3.toLocaleString()}
                  </td>
                  <td className="border border-zinc-700 px-2 py-2 text-right font-semibold tabular-nums text-cyan-400">
                    {row.production_needed.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
