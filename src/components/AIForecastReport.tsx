"use client";

import { useState, useEffect, useCallback } from "react";
import { useInventory } from "@/context/InventoryContext";
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
  forecast_this_month?: number;
  forecast_month1: number;
  forecast_month2: number;
  forecast_month3: number;
  production_needed: number;
  yoy_pct?: number;
  last_year_base?: number;
}

export interface CategoryForecast {
  forecast_this_month?: number;
  forecast_month1: number;
  forecast_month2: number;
  forecast_month3: number;
  production_needed: number;
  yoy_pct?: number;
  last_year_base?: number;
}

export interface ForecastResponse {
  forecast_this_month_label?: string;
  forecast_month_labels: string[];
  product_forecasts: ForecastItem[];
  category_forecast: Record<string, CategoryForecast>;
  summary: {
    total_products_forecasted: number;
    total_production_needed_3m: number;
    excluded_categories?: string[];
  };
  category_avg_yoy?: Record<string, number>;
}

const CATEGORY_COLORS: Record<string, string> = {
  마스크: "#22d3ee",
  캡슐: "#a78bfa",
  캡슐세제: "#a78bfa",
  원단: "#f472b6",
  액상: "#34d399",
  액상세제: "#34d399",
  리빙: "#fbbf24",
  생활용품: "#fbbf24",
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
  const { dataRefreshKey, refresh } = useInventory() ?? {};
  const [data, setData] = useState<ForecastResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20_000);
    fetch(`/api/forecast?t=${Date.now()}`, { signal: controller.signal, cache: "no-store" })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          const msg = (json?.error as string) || res.statusText || "서버 오류";
          throw new Error(msg);
        }
        if (json?.error) throw new Error(String(json.error));
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

  const refreshKey = dataRefreshKey ?? 0;
  useEffect(() => {
    const cleanup = loadData();
    return () => (typeof cleanup === "function" ? cleanup() : undefined);
  }, [loadData, refreshKey]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-zinc-700 bg-zinc-900/50 p-8 text-center">
        <p className="text-zinc-500">AI 예측 분석 중…</p>
        <p className="mt-2 text-xs text-zinc-600">
          Run-rate 당월 + 3개월평균·추세 기반 수요 예측.
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
          onClick={() => refresh?.() ?? loadData()}
          className="mt-3 rounded-lg bg-red-500/20 px-4 py-2 text-sm text-red-300 hover:bg-red-500/30"
        >
          다시 시도
        </button>
      </div>
    );
  }

  const thisMonthLabel = data.forecast_this_month_label ?? "";
  const labels = data.forecast_month_labels ?? ["M1", "M2", "M3"];
  const m1 = labels[0] ?? "M1";
  const m2 = labels[1] ?? "M2";
  const m3 = labels[2] ?? "M3";
  const categoryChartData = Object.entries(data.category_forecast ?? {}).map(
    ([cat, v]) => ({
      category: cat,
      ...(thisMonthLabel ? { [thisMonthLabel]: v.forecast_this_month ?? 0 } : {}),
      [m1]: v.forecast_month1,
      [m2]: v.forecast_month2,
      [m3]: v.forecast_month3,
      production_needed: v.production_needed,
    })
  );

  const HIGH_VOLUME_THRESHOLD = 1_000_000;
  const highVolumeData = categoryChartData.filter((r) => (r.production_needed as number) >= HIGH_VOLUME_THRESHOLD);
  const lowVolumeData = categoryChartData.filter((r) => (r.production_needed as number) < HIGH_VOLUME_THRESHOLD);

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
        M0: Run-rate. 추세=M0−3개월평균. M1=3개월평균+추세, M2=M1+추세, M3=M2+추세. Clamping: 0~직전달×2.
      </p>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {thisMonthLabel && (
          <div className="rounded-xl border border-slate-500/40 bg-slate-500/10 p-4">
            <div className="text-xs font-medium uppercase tracking-wider text-slate-400">
              당월 예측 ({thisMonthLabel})
            </div>
            <div className="mt-1 text-xl font-bold tabular-nums text-white md:text-2xl">
              {Object.values(data.category_forecast ?? {}).reduce((s, c) => s + (c.forecast_this_month ?? 0), 0).toLocaleString()}개
            </div>
          </div>
        )}
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
        {data.category_avg_yoy && Object.keys(data.category_avg_yoy).length > 0 && (
          <div className="col-span-2 sm:col-span-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
            <div className="text-xs font-medium uppercase tracking-wider text-amber-400">
              카테고리별 YoY (연평균 성장률)
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {Object.entries(data.category_avg_yoy).map(([cat, ratio]) => {
                const pct = Math.round((ratio - 1) * 1000) / 10;
                return (
                  <span key={cat} className={pct >= 0 ? "text-emerald-300" : "text-red-400"}>
                    {cat}: {pct >= 0 ? "+" : ""}{pct}%
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {(data.summary?.excluded_categories?.length ?? 0) > 0 && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          신규 카테고리(데이터 3개월 미만): {data.summary.excluded_categories!.join(", ")} — 수동 입력 모드
        </p>
      )}

      {/* 카테고리별 예측 차트: 왼쪽 100만 이상 / 오른쪽 100만 미만 */}
      {categoryChartData.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-zinc-300">
            카테고리별 예상 출고량 (당월 + 향후 3개월)
          </h3>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {highVolumeData.length > 0 && (
              <div className="min-w-0 rounded-xl border border-zinc-600 bg-zinc-800/60 p-4">
                <div className="mb-2 text-xs font-medium text-cyan-400">
                  대량 (100만 개 이상)
                </div>
                <div className="h-56 w-full min-w-0 md:h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={highVolumeData}
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
                      {thisMonthLabel && (
                        <Bar
                          key={thisMonthLabel}
                          dataKey={thisMonthLabel}
                          name={`${thisMonthLabel} (당월)`}
                          fill="#64748b"
                          radius={[4, 4, 0, 0]}
                        />
                      )}
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
            {lowVolumeData.length > 0 && (
              <div className="min-w-0 rounded-xl border border-zinc-600 bg-zinc-800/60 p-4">
                <div className="mb-2 text-xs font-medium text-amber-400">
                  소량 (100만 개 미만)
                </div>
                <div className="h-56 w-full min-w-0 md:h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={lowVolumeData}
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
                      {thisMonthLabel && (
                        <Bar
                          key={thisMonthLabel}
                          dataKey={thisMonthLabel}
                          name={`${thisMonthLabel} (당월)`}
                          fill="#64748b"
                          radius={[4, 4, 0, 0]}
                        />
                      )}
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
                <th className="border border-zinc-600 bg-zinc-800/80 px-2 py-2 text-right text-xs font-medium text-zinc-400" title="전년 대비 예상 증감률">
                  YoY %
                </th>
                <th className="border border-zinc-600 bg-zinc-800/80 px-2 py-2 text-right text-xs font-medium text-zinc-400" title="작년 동월+3개월 합계">
                  작년 기준
                </th>
                {thisMonthLabel && (
                  <th className="border border-zinc-600 bg-zinc-800/80 px-2 py-2 text-right text-xs font-medium text-zinc-400">
                    {thisMonthLabel} (당월)
                  </th>
                )}
                <th className="border border-zinc-600 bg-zinc-800/80 px-2 py-2 text-right text-xs font-medium text-zinc-400">
                  {m1}
                </th>
                <th className="border border-zinc-600 bg-zinc-800/80 px-2 py-2 text-right text-xs font-medium text-zinc-400">
                  {m2}
                </th>
                <th className="border border-zinc-600 bg-zinc-800/80 px-2 py-2 text-right text-xs font-medium text-zinc-400">
                  {m3}
                </th>
                <th className="border border-zinc-600 bg-zinc-800/80 px-2 py-2 text-right text-xs font-medium text-zinc-400" title="M1+M2+M3 합계">
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
                  <td className="border border-zinc-700 px-2 py-2 text-right tabular-nums">
                    <span className={row.yoy_pct != null && row.yoy_pct >= 0 ? "text-emerald-400" : "text-red-400"}>
                      {row.yoy_pct != null ? `${row.yoy_pct >= 0 ? "+" : ""}${row.yoy_pct}%` : "-"}
                    </span>
                  </td>
                  <td className="border border-zinc-700 px-2 py-2 text-right tabular-nums text-zinc-500">
                    {(row.last_year_base ?? 0).toLocaleString()}
                  </td>
                  {thisMonthLabel && (
                    <td className="border border-zinc-700 px-2 py-2 text-right tabular-nums text-zinc-400">
                      {(row.forecast_this_month ?? 0).toLocaleString()}
                    </td>
                  )}
                  <td className="border border-zinc-700 px-2 py-2 text-right tabular-nums text-zinc-300">
                    {row.forecast_month1.toLocaleString()}
                  </td>
                  <td className="border border-zinc-700 px-2 py-2 text-right tabular-nums text-zinc-300">
                    {row.forecast_month2.toLocaleString()}
                  </td>
                  <td className="border border-zinc-700 px-2 py-2 text-right tabular-nums text-zinc-300">
                    {row.forecast_month3.toLocaleString()}
                  </td>
                  <td className="border border-zinc-700 px-2 py-2 text-right font-semibold tabular-nums text-cyan-400" title="M1+M2+M3 합계 (3개월평균+추세 선형)">
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
