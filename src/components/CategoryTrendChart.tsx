"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

/** 카테고리별 색상 (5개 고정: 마스크, 캡슐세제, 섬유유연제, 액상세제, 생활용품) */
const CATEGORY_COLORS: Record<string, string> = {
  마스크: "#22d3ee",
  캡슐세제: "#a78bfa",
  섬유유연제: "#f472b6",
  액상세제: "#34d399",
  생활용품: "#fbbf24",
  기타: "#94a3b8",
};

function getColorForCategory(category: string, index: number): string {
  return (
    CATEGORY_COLORS[category] ??
    [
      "#22d3ee",
      "#a78bfa",
      "#f472b6",
      "#34d399",
      "#fbbf24",
      "#94a3b8",
      "#fb923c",
      "#38bdf8",
    ][index % 8]
  );
}

export interface CategoryTrendData {
  months: string[];
  categories: string[];
  chartData: Record<string, string | number>[];
  momRates: Record<string, Record<string, number | null>>;
  momIndicators?: {
    outbound: number | null;
    inbound: number | null;
    thisMonthOutbound: number;
    thisMonthInbound: number;
    thisMonthOutboundValue?: number;
    thisMonthInboundValue?: number;
    thisMonthOutboundCoupang?: number;
    thisMonthOutboundGeneral?: number;
    thisMonthInboundCoupang?: number;
    thisMonthInboundGeneral?: number;
  };
}

type YearFilter = "all" | "2025" | "2026";

export function CategoryTrendChart() {
  const [data, setData] = useState<CategoryTrendData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [yearFilter, setYearFilter] = useState<YearFilter>("all");

  const loadData = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);
    fetch("/api/category-trend", { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(res.statusText);
        let json: CategoryTrendData;
        try {
          json = await res.json();
        } catch {
          throw new Error("API 응답 파싱 실패 (JSON 오류)");
        }
        if (json == null || typeof json !== "object") throw new Error("API 응답 형식 오류");
        return json;
      })
      .then((json: CategoryTrendData) => {
        if (!cancelled) {
          setData(json);
          setSelectedCategories(new Set(json?.categories ?? []));
        }
      })
      .catch((e) => {
        if (!cancelled) {
          const msg = e instanceof Error && e.name === "AbortError"
            ? "요청 시간 초과 (15초). 새로고침을 눌러 재시도하세요."
            : e instanceof Error ? e.message : "Failed to load";
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

  const toggleCategory = (cat: string) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) {
        next.delete(cat);
      } else {
        next.add(cat);
      }
      return next;
    });
  };

  const selectAll = () => {
    if (data) setSelectedCategories(new Set(data.categories));
  };

  const deselectAll = () => {
    setSelectedCategories(new Set());
  };

  const filteredMonths = useMemo(() => {
    if (!data?.months) return [];
    if (yearFilter === "all") return data.months;
    return data.months.filter((m) => m.startsWith(yearFilter));
  }, [data?.months, yearFilter]);

  const filteredChartData = useMemo(() => {
    if (!data?.chartData) return [];
    if (selectedCategories.size === 0) return [];
    let rows = data.chartData;
    if (yearFilter !== "all") {
      rows = rows.filter((r) => String(r.month ?? "").startsWith(yearFilter));
    }
    return rows.map((row) => {
      const filtered: Record<string, string | number> = { month: row.month };
      Array.from(selectedCategories).forEach((cat) => {
        if (row[cat] !== undefined) filtered[cat] = row[cat] as number;
      });
      return filtered;
    });
  }, [data?.chartData, selectedCategories, yearFilter]);

  const filteredMomTable = useMemo(() => {
    if (!data?.momRates) return [];
    const cats = data.categories.filter((c) => selectedCategories.has(c));
    const ratesFiltered = (rates: Record<string, number | null>) => {
      if (yearFilter === "all") return rates;
      return Object.fromEntries(
        Object.entries(rates).filter(([m]) => m.startsWith(yearFilter))
      );
    };
    return cats.map((cat) => ({
      category: cat,
      rates: ratesFiltered(data.momRates[cat] ?? {}),
    }));
  }, [data?.momRates, data?.categories, selectedCategories, yearFilter]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-zinc-700 bg-zinc-900/50 p-8 text-center">
        <p className="text-zinc-500">카테고리별 판매 동향을 불러오는 중…</p>
        <p className="mt-2 text-xs text-zinc-600">15초 이상 걸리면 새로고침 후 다시 시도하세요.</p>
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

  if (data.categories.length === 0) {
    return (
      <div className="rounded-2xl border border-zinc-700 bg-zinc-900/50 p-8 text-center text-zinc-500">
        최근 12개월 출고 데이터가 없습니다.
      </div>
    );
  }

  const mom = data.momIndicators;

  return (
    <div className="min-w-0 space-y-6 overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900/80 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-white md:text-xl">
          카테고리별 월별 판매 동향
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            연도
          </span>
          {(["all", "2025", "2026"] as const).map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => setYearFilter(y)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                yearFilter === y
                  ? "bg-cyan-500/30 text-cyan-300 ring-1 ring-cyan-500/50"
                  : "text-zinc-400 hover:bg-zinc-700 hover:text-white"
              }`}
            >
              {y === "all" ? "전체" : `${y}년`}
            </button>
          ))}
        </div>
      </div>

      {/* 주요 지표 + 전월 대비 증감율 */}
      {mom && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-xl border border-zinc-700 bg-zinc-800/80 p-4">
            <div className="text-xs font-medium uppercase tracking-wider text-zinc-500">이번 달 총 판매</div>
            <div className="mt-1 flex flex-wrap items-baseline gap-2">
              <span className="text-xl font-bold tabular-nums text-white md:text-2xl">
                {mom.thisMonthOutbound.toLocaleString()}EA
              </span>
              {(mom.thisMonthOutboundValue ?? 0) > 0 && (
                <span className="text-sm text-cyan-400">
                  ₩{(mom.thisMonthOutboundValue ?? 0).toLocaleString()}
                </span>
              )}
              {mom.outbound != null && (
                <span className={`flex items-center text-sm font-medium ${mom.outbound >= 0 ? "text-red-400" : "text-blue-400"}`}>
                  {mom.outbound >= 0 ? "▲" : "▼"} {Math.abs(mom.outbound)}%
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 text-[11px] text-zinc-400">
              <span>쿠팡: {(mom.thisMonthOutboundCoupang ?? 0).toLocaleString()}EA</span>
              <span>일반: {(mom.thisMonthOutboundGeneral ?? 0).toLocaleString()}EA</span>
            </div>
            <div className="mt-0.5 text-[10px] text-zinc-500">1일~오늘 누적 · 전월 대비</div>
          </div>
          <div className="rounded-xl border border-zinc-700 bg-zinc-800/80 p-4">
            <div className="text-xs font-medium uppercase tracking-wider text-zinc-500">이번 달 총 입고</div>
            <div className="mt-1 flex flex-wrap items-baseline gap-2">
              <span className="text-xl font-bold tabular-nums text-white md:text-2xl">
                {mom.thisMonthInbound.toLocaleString()}EA
              </span>
              {(mom.thisMonthInboundValue ?? 0) > 0 && (
                <span className="text-sm text-cyan-400">
                  ₩{(mom.thisMonthInboundValue ?? 0).toLocaleString()}
                </span>
              )}
              {mom.inbound != null && (
                <span className={`flex items-center text-sm font-medium ${mom.inbound >= 0 ? "text-red-400" : "text-blue-400"}`}>
                  {mom.inbound >= 0 ? "▲" : "▼"} {Math.abs(mom.inbound)}%
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 text-[11px] text-zinc-400">
              <span>쿠팡: {(mom.thisMonthInboundCoupang ?? 0).toLocaleString()}EA</span>
              <span>일반: {(mom.thisMonthInboundGeneral ?? 0).toLocaleString()}EA</span>
            </div>
            <div className="mt-0.5 text-[10px] text-zinc-500">1일~오늘 누적 · 전월 대비</div>
          </div>
        </div>
      )}

      {/* 카테고리 체크박스 필터 */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
          카테고리 필터
        </span>
        <div className="flex flex-wrap gap-2">
          {data.categories.map((cat, idx) => (
            <label
              key={cat}
              className="flex cursor-pointer items-center gap-2 rounded-xl border border-zinc-600 bg-zinc-800/80 px-3 py-2 transition-colors hover:bg-zinc-700/80"
            >
              <input
                type="checkbox"
                checked={selectedCategories.has(cat)}
                onChange={() => toggleCategory(cat)}
                className="h-4 w-4 rounded border-zinc-500 bg-zinc-800 text-cyan-500 focus:ring-cyan-500"
              />
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: getColorForCategory(cat, idx) }}
              />
              <span className="text-sm text-zinc-300">{cat}</span>
            </label>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={selectAll}
            className="rounded-lg px-3 py-1.5 text-xs text-cyan-400 hover:bg-zinc-700 hover:text-white"
          >
            전체 선택
          </button>
          <button
            type="button"
            onClick={deselectAll}
            className="rounded-lg px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-white"
          >
            전체 해제
          </button>
        </div>
      </div>

      {/* 누적 영역 차트(Stacked Area Chart) - 시각적으로 크게 */}
      {selectedCategories.size === 0 ? (
        <div className="flex h-72 items-center justify-center rounded-xl border border-dashed border-zinc-600 bg-zinc-800/30 text-zinc-500 md:h-96">
          카테고리를 선택하세요
        </div>
      ) : (
        <div className="h-72 w-full min-w-0 md:h-[400px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={filteredChartData}
            margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
          >
            <defs>
              {data.categories
                .filter((c) => selectedCategories.has(c))
                .map((cat, idx) => (
                  <linearGradient
                    key={cat}
                    id={`gradient-${cat}`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="0%"
                      stopColor={getColorForCategory(cat, idx)}
                      stopOpacity={0.8}
                    />
                    <stop
                      offset="100%"
                      stopColor={getColorForCategory(cat, idx)}
                      stopOpacity={0.2}
                    />
                  </linearGradient>
                ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
            <XAxis
              dataKey="month"
              stroke="#71717a"
              tick={{ fill: "#a1a1aa", fontSize: 11 }}
              tickFormatter={(v) => v.slice(2)}
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
              labelStyle={{ color: "#fafafa" }}
              formatter={(value, name) => [
                typeof value === "number" ? value.toLocaleString() : String(value ?? "-"),
                name,
              ]}
              labelFormatter={(label) => (
                <span className="text-cyan-400">{label}</span>
              )}
            />
            <Legend
              wrapperStyle={{ paddingTop: 8 }}
              formatter={(value) => (
                <span className="text-sm text-zinc-300">{value}</span>
              )}
            />
            {data.categories
              .filter((c) => selectedCategories.has(c))
              .map((cat, idx) => (
                <Area
                  key={cat}
                  type="monotone"
                  dataKey={cat}
                  stackId="1"
                  stroke={getColorForCategory(cat, idx)}
                  fill={`url(#gradient-${cat})`}
                  strokeWidth={1.5}
                />
              ))}
          </AreaChart>
        </ResponsiveContainer>
        </div>
      )}

      {/* 전월 대비 증감률(%) 표 */}
      <div className="min-w-0 overflow-x-auto">
        <h3 className="mb-3 text-sm font-semibold text-zinc-300">
          전월 대비 증감률 (%)
        </h3>
        {filteredMomTable.length === 0 ? (
          <div className="rounded-xl border border-zinc-700 bg-zinc-800/30 py-8 text-center text-zinc-500">
            카테고리를 선택하면 전월 대비 증감률을 확인할 수 있습니다.
          </div>
        ) : (
          <table className="w-full min-w-[480px] border-collapse text-sm">
          <thead>
            <tr>
              <th className="border border-zinc-600 bg-zinc-800/80 px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">
                카테고리
              </th>
              {filteredMonths.map((m) => (
                <th
                  key={m}
                  className="border border-zinc-600 bg-zinc-800/80 px-2 py-2 text-center text-xs font-medium text-zinc-400"
                >
                  {m.slice(2)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredMomTable.map(({ category, rates }) => (
              <tr key={category} className="hover:bg-zinc-800/50">
                <td className="border border-zinc-700 px-3 py-2 font-medium text-zinc-200">
                  {category}
                </td>
                {filteredMonths.map((m) => {
                  const rate = rates[m];
                  const isPlus = rate != null && rate > 0;
                  const isMinus = rate != null && rate < 0;
                  return (
                    <td
                      key={m}
                      className="border border-zinc-700 px-2 py-2 text-center tabular-nums"
                    >
                      {rate == null ? (
                        <span className="text-zinc-500">-</span>
                      ) : (
                        <span
                          className={
                            isPlus
                              ? "text-emerald-400"
                              : isMinus
                                ? "text-red-400"
                                : "text-zinc-400"
                          }
                        >
                          {rate > 0 ? "+" : ""}
                          {rate}%
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
