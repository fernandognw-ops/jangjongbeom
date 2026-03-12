"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
import { useInventory } from "@/context/InventoryContext";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  Cell,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from "recharts";

/** 카테고리별 색상 */
const CATEGORY_COLORS: Record<string, string> = {
  마스크: "#22d3ee",
  캡슐세제: "#a78bfa",
  섬유유연제: "#f472b6",
  액상세제: "#34d399",
  생활용품: "#fbbf24",
  캡슐사은품: "#fb923c",
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

/** 카테고리 표시용 짧은 이름 (차트·필터 공간 절약) */
const CATEGORY_SHORT: Record<string, string> = {
  마스크: "마스크",
  캡슐세제: "캡슐",
  섬유유연제: "섬유",
  액상세제: "액상",
  생활용품: "생활",
  캡슐사은품: "캡슐사은품",
  "3개월 이동평균": "3M평균",
};
function shortCategoryLabel(cat: string): string {
  return CATEGORY_SHORT[cat] ?? (cat.length > 4 ? `${cat.slice(0, 4)}…` : cat);
}

export interface CategoryTrendData {
  months: string[];
  categories: string[];
  chartData: Record<string, string | number>[];
  momRates: Record<string, Record<string, number | null>>;
  monthlyTotals?: Record<string, {
    outbound: number;
    inbound: number;
    outboundValue?: number;
    inboundValue?: number;
    outboundValueCoupang?: number;
    outboundValueGeneral?: number;
  }>;
  monthlyValueByCategory?: Record<string, Record<string, number>>;
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
  const { dataRefreshKey } = useInventory() ?? {};
  const [data, setData] = useState<CategoryTrendData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [yearFilter, setYearFilter] = useState<YearFilter>("all");
  const [showTrendLine, setShowTrendLine] = useState(true);
  const [showMovingAvg, setShowMovingAvg] = useState(true);

  const loadData = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);
    fetch(`/api/category-trend?t=${Date.now()}`, { signal: controller.signal, cache: "no-store" })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          const msg = (json?.error as string) || res.statusText || "서버 오류";
          throw new Error(msg);
        }
        if (json == null || typeof json !== "object") throw new Error("API 응답 형식 오류");
        if (json.error) throw new Error(String(json.error));
        return json as CategoryTrendData;
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
  }, [loadData, dataRefreshKey ?? 0]);

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
    const base = rows.map((row) => {
      const filtered: Record<string, string | number> = { month: row.month };
      let total = 0;
      Array.from(selectedCategories).forEach((cat) => {
        const val = (row[cat] as number) ?? 0;
        filtered[cat] = val;
        total += val;
      });
      filtered._total = total;
      return filtered;
    });

    // 선형 추세선: y = mx + b (최소제곱법)
    const n = base.length;
    if (n >= 2) {
      let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
      for (let i = 0; i < n; i++) {
        const x = i;
        const y = (base[i]._total as number) ?? 0;
        sumX += x;
        sumY += y;
        sumXY += x * y;
        sumX2 += x * x;
      }
      const m = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX) || 0;
      const b = (sumY - m * sumX) / n;
      base.forEach((row, i) => {
        row.trend = Math.round(m * i + b);
      });
    }

    // 3개월 이동평균
    const maWindow = 3;
    for (let i = 0; i < n; i++) {
      let sum = 0;
      let count = 0;
      for (let j = Math.max(0, i - maWindow + 1); j <= i; j++) {
        sum += (base[j]._total as number) ?? 0;
        count++;
      }
      base[i].ma3 = count > 0 ? Math.round(sum / count) : 0;
    }

    return base.map(({ _total, ...rest }) => rest);
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

  const HIGH_VOLUME_THRESHOLD = 1_000_000;
  const { highVolCats, lowVolCats, chartDataHigh, chartDataLow } = useMemo(() => {
    if (!data?.chartData || selectedCategories.size === 0) {
      return { highVolCats: [] as string[], lowVolCats: [] as string[], chartDataHigh: [], chartDataLow: [] };
    }
    const catTotals: Record<string, number> = {};
    for (const row of data.chartData) {
      for (const cat of selectedCategories) {
        catTotals[cat] = (catTotals[cat] ?? 0) + ((row[cat] as number) ?? 0);
      }
    }
    const highVolCats = Array.from(selectedCategories).filter((c) => (catTotals[c] ?? 0) >= HIGH_VOLUME_THRESHOLD);
    const lowVolCats = Array.from(selectedCategories).filter((c) => (catTotals[c] ?? 0) < HIGH_VOLUME_THRESHOLD);

    let rows = data.chartData;
    if (yearFilter !== "all") {
      rows = rows.filter((r) => String(r.month ?? "").startsWith(yearFilter));
    }

    const buildChartData = (cats: string[]) => {
      if (cats.length === 0) return [];
      const base = rows.map((row) => {
        const filtered: Record<string, string | number> = { month: row.month };
        let total = 0;
        cats.forEach((cat) => {
          const val = (row[cat] as number) ?? 0;
          filtered[cat] = val;
          total += val;
        });
        filtered._total = total;
        return filtered;
      });
      const n = base.length;
      if (n >= 2) {
        let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
        for (let i = 0; i < n; i++) {
          const x = i;
          const y = (base[i]._total as number) ?? 0;
          sumX += x;
          sumY += y;
          sumXY += x * y;
          sumX2 += x * x;
        }
        const m = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX) || 0;
        const b = (sumY - m * sumX) / n;
        base.forEach((row, i) => {
          row.trend = Math.round(m * i + b);
        });
      }
      const maWindow = 3;
      for (let i = 0; i < n; i++) {
        let sum = 0;
        let count = 0;
        for (let j = Math.max(0, i - maWindow + 1); j <= i; j++) {
          sum += (base[j]._total as number) ?? 0;
          count++;
        }
        base[i].ma3 = count > 0 ? Math.round(sum / count) : 0;
      }
      return base.map(({ _total, ...rest }) => rest);
    };

    return {
      highVolCats,
      lowVolCats,
      chartDataHigh: buildChartData(highVolCats),
      chartDataLow: buildChartData(lowVolCats),
    };
  }, [data?.chartData, selectedCategories, yearFilter]);

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

      {/* 월 평균 재고 증감 그래프 */}
      {data.monthlyTotals && Object.keys(data.monthlyTotals).length > 0 && (() => {
        const monthsToUse = yearFilter === "all"
          ? (data.months ?? [])
          : (data.months ?? []).filter((m) => m.startsWith(yearFilter));
        const invChangeData = monthsToUse
          .filter((m) => data.monthlyTotals![m])
          .map((month) => {
            const t = data.monthlyTotals![month];
            const delta = (t.inbound ?? 0) - (t.outbound ?? 0);
            return { month, delta, 입고: t.inbound ?? 0, 출고: t.outbound ?? 0 };
          });
        const avgDelta = invChangeData.length > 0
          ? Math.round(invChangeData.reduce((s, r) => s + r.delta, 0) / invChangeData.length)
          : 0;
        return (
          <div className="rounded-xl border border-zinc-600 bg-zinc-800/60 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-rose-400">월별 재고 증감 (입고 − 출고)</h3>
                <p className="mt-0.5 text-[10px] text-zinc-500">녹색: 증가 · 적색: 감소</p>
              </div>
              <div className="text-xs text-zinc-400">
                월 평균: <span className={avgDelta >= 0 ? "font-semibold text-emerald-400" : "font-semibold text-rose-400"}>
                  {avgDelta >= 0 ? "+" : ""}{avgDelta.toLocaleString()}EA
                </span>
              </div>
            </div>
            <div className="h-56 w-full min-w-0 md:h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={invChangeData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
                  <XAxis dataKey="month" stroke="#71717a" tick={{ fill: "#a1a1aa", fontSize: 11 }} tickFormatter={(v) => (v ? String(v).slice(2) : "")} />
                  <YAxis stroke="#71717a" tick={{ fill: "#a1a1aa", fontSize: 11 }} tickFormatter={(v) => v.toLocaleString()} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#18181b", border: "1px solid #3f3f46", borderRadius: "8px" }}
                    formatter={(value: number) => value.toLocaleString()}
                    labelFormatter={(label) => <span className="text-cyan-400">{label}</span>}
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const p = payload[0]?.payload as { delta: number; 입고: number; 출고: number };
                      return (
                        <div className="rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2 text-xs">
                          <div className="font-medium text-cyan-400">{label}</div>
                          <div>입고: {p.입고.toLocaleString()}EA</div>
                          <div>출고: {p.출고.toLocaleString()}EA</div>
                          <div className={p.delta >= 0 ? "text-emerald-400" : "text-rose-400"}>
                            증감: {p.delta >= 0 ? "+" : ""}{p.delta.toLocaleString()}EA
                          </div>
                        </div>
                      );
                    }}
                  />
                  <ReferenceLine y={0} stroke="#71717a" strokeWidth={1} />
                  <Bar dataKey="delta" name="재고 증감" radius={[4, 4, 0, 0]}>
                    {invChangeData.map((entry, idx) => (
                      <Cell key={`cell-${idx}`} fill={entry.delta >= 0 ? "#34d399" : "#f87171"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })()}

      {/* 판매 채널별 월별 매출 금액 (쿠팡 / 일반) */}
      {data.monthlyTotals && Object.keys(data.monthlyTotals).length > 0 && (() => {
        const monthsToUse = yearFilter === "all"
          ? (data.months ?? [])
          : (data.months ?? []).filter((m) => m.startsWith(yearFilter));
        const channelData = monthsToUse
          .filter((m) => data.monthlyTotals![m])
          .map((month) => {
            const t = data.monthlyTotals![month];
            const coupang = t.outboundValueCoupang ?? 0;
            const general = t.outboundValueGeneral ?? 0;
            const total = coupang + general;
            return {
              month,
              쿠팡: coupang,
              일반: general,
              total,
              coupangPct: total > 0 ? Math.round((coupang / total) * 100) : 0,
              generalPct: total > 0 ? Math.round((general / total) * 100) : 0,
            };
          });
        const totalSales = channelData.reduce((s, r) => s + r.total, 0);
        const coupangTotal = channelData.reduce((s, r) => s + r.쿠팡, 0);
        const generalTotal = channelData.reduce((s, r) => s + r.일반, 0);
        const cnt = channelData.length || 1;
        const coupangAvg = Math.round(coupangTotal / cnt);
        const generalAvg = Math.round(generalTotal / cnt);
        const coupangShare = totalSales > 0 ? Math.round((coupangTotal / totalSales) * 100) : 0;
        const generalShare = totalSales > 0 ? Math.round((generalTotal / totalSales) * 100) : 0;
        const COUPANG_COLOR = "#f97316";
        const GENERAL_COLOR = "#3b82f6";
        return (
          <div className="rounded-xl border border-zinc-600 bg-zinc-800/60 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-cyan-400">판매 채널별 월별 매출 금액</h3>
                <p className="mt-0.5 text-[10px] text-zinc-500">쿠팡 vs 일반(외) 채널 · 분석용</p>
              </div>
            </div>
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-zinc-600 bg-zinc-900/80 px-3 py-2">
                <div className="text-[10px] text-zinc-500">총 매출</div>
                <div className="text-sm font-bold tabular-nums text-white">₩{totalSales.toLocaleString()}</div>
              </div>
              <div className="rounded-lg border border-zinc-600 bg-zinc-900/80 px-3 py-2">
                <div className="text-[10px] text-zinc-500">쿠팡 월평균</div>
                <div className="text-sm font-bold tabular-nums" style={{ color: COUPANG_COLOR }}>₩{coupangAvg.toLocaleString()}</div>
                <div className="text-[10px] text-zinc-500">{coupangShare}% 비중</div>
              </div>
              <div className="rounded-lg border border-zinc-600 bg-zinc-900/80 px-3 py-2">
                <div className="text-[10px] text-zinc-500">일반 월평균</div>
                <div className="text-sm font-bold tabular-nums" style={{ color: GENERAL_COLOR }}>₩{generalAvg.toLocaleString()}</div>
                <div className="text-[10px] text-zinc-500">{generalShare}% 비중</div>
              </div>
              <div className="rounded-lg border border-zinc-600 bg-zinc-900/80 px-3 py-2">
                <div className="text-[10px] text-zinc-500">기간</div>
                <div className="text-sm font-medium text-zinc-300">{channelData.length}개월</div>
              </div>
            </div>
            <div className="h-56 w-full min-w-0 md:h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={channelData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
                  <XAxis dataKey="month" stroke="#71717a" tick={{ fill: "#a1a1aa", fontSize: 11 }} tickFormatter={(v) => (v ? String(v).slice(2) : "")} />
                  <YAxis stroke="#71717a" tick={{ fill: "#a1a1aa", fontSize: 11 }} tickFormatter={(v) => `₩${(v / 10000).toFixed(0)}만`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#18181b", border: "1px solid #3f3f46", borderRadius: "8px" }}
                    formatter={(value: number) => [`₩${(value ?? 0).toLocaleString()}`, ""]}
                    labelFormatter={(label) => <span className="text-cyan-400">{label}</span>}
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const p = payload[0]?.payload as { month: string; 쿠팡: number; 일반: number; total: number; coupangPct: number; generalPct: number };
                      return (
                        <div className="rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2 text-xs min-w-[180px]">
                          <div className="font-medium text-cyan-400">{label}</div>
                          <div className="mt-1 font-semibold text-white">총 ₩{(p.total ?? 0).toLocaleString()}</div>
                          <div className="mt-1 flex justify-between gap-4">
                            <span style={{ color: COUPANG_COLOR }}>쿠팡</span>
                            <span>₩{(p.쿠팡 ?? 0).toLocaleString()} ({p.coupangPct ?? 0}%)</span>
                          </div>
                          <div className="flex justify-between gap-4">
                            <span style={{ color: GENERAL_COLOR }}>일반</span>
                            <span>₩{(p.일반 ?? 0).toLocaleString()} ({p.generalPct ?? 0}%)</span>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Legend formatter={(value) => (
                    <span className="text-sm" style={{ color: value === "쿠팡" ? COUPANG_COLOR : GENERAL_COLOR }}>{value}</span>
                  )} />
                  <Bar dataKey="쿠팡" fill={COUPANG_COLOR} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="일반" fill={GENERAL_COLOR} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })()}

      {/* 월별 실제 재고 자산금액 (카테고리별 누적, 스택 막대) */}
      {data.monthlyValueByCategory && Object.keys(data.monthlyValueByCategory).length > 0 && (() => {
        const monthsToUse = yearFilter === "all"
          ? (data.months ?? [])
          : (data.months ?? []).filter((m) => m.startsWith(yearFilter));
        const valueChartData = monthsToUse
          .filter((m) => data.monthlyValueByCategory![m])
          .map((month) => {
            const row: Record<string, string | number> = { month };
            const vals = data.monthlyValueByCategory![month];
            let total = 0;
            for (const cat of data.categories) {
              const v = vals[cat] ?? 0;
              row[cat] = v;
              total += v;
            }
            row.total = total;
            return row;
          });
        return (
          <div className="rounded-xl border border-zinc-600 bg-zinc-800/60 p-4">
            <h3 className="mb-3 text-sm font-semibold text-zinc-300">월별 실제 재고 자산금액 (카테고리별 누적)</h3>
            <div className="h-56 w-full min-w-0 md:h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={valueChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
                  <XAxis dataKey="month" stroke="#71717a" tick={{ fill: "#a1a1aa", fontSize: 11 }} tickFormatter={(v) => (v ? String(v).slice(2) : "")} />
                  <YAxis stroke="#71717a" tick={{ fill: "#a1a1aa", fontSize: 11 }} tickFormatter={(v) => `₩${(v / 10000).toFixed(0)}만`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#18181b", border: "1px solid #3f3f46", borderRadius: "8px" }}
                    formatter={(value: number) => [`₩${(value ?? 0).toLocaleString()}`, ""]}
                    labelFormatter={(label) => <span className="text-cyan-400">{label}</span>}
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const p = payload[0]?.payload as Record<string, string | number>;
                      const cats = data.categories.filter((c) => (p[c] as number) > 0);
                      return (
                        <div className="rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2 text-xs">
                          <div className="font-medium text-cyan-400">{label}</div>
                          <div className="mt-1 font-semibold text-white">총 ₩{(p.total as number)?.toLocaleString()}</div>
                          {cats.map((cat) => (
                            <div key={cat} className="flex justify-between gap-4">
                              <span style={{ color: getColorForCategory(cat, data.categories.indexOf(cat)) }}>{shortCategoryLabel(cat)}</span>
                              <span>₩{((p[cat] as number) ?? 0).toLocaleString()}</span>
                            </div>
                          ))}
                        </div>
                      );
                    }}
                  />
                  <Legend formatter={(value) => <span className="text-sm text-zinc-300" title={value}>{shortCategoryLabel(value)}</span>} />
                  {data.categories.map((cat, idx) => (
                    <Bar key={cat} dataKey={cat} stackId="value" fill={getColorForCategory(cat, idx)} radius={idx === data.categories.length - 1 ? [4, 4, 0, 0] : 0} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })()}

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
        <div className="flex items-center gap-2 rounded-lg border border-zinc-600 bg-zinc-800/60 px-2 py-1.5">
          <button
            type="button"
            onClick={selectAll}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              selectedCategories.size === data.categories.length
                ? "bg-cyan-500/30 text-cyan-300 ring-1 ring-cyan-500/50"
                : "text-zinc-400 hover:bg-zinc-700 hover:text-white"
            }`}
          >
            전체 선택
          </button>
          <button
            type="button"
            onClick={deselectAll}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              selectedCategories.size === 0
                ? "bg-zinc-600 text-zinc-300 ring-1 ring-zinc-500/50"
                : "text-zinc-400 hover:bg-zinc-700 hover:text-white"
            }`}
          >
            전체 해제
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-l border-zinc-600 pl-3">
          <span className="text-xs text-zinc-500">분석</span>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-600 bg-zinc-800/60 px-3 py-1.5">
            <input
              type="checkbox"
              checked={showTrendLine}
              onChange={(e) => setShowTrendLine(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-zinc-500 text-amber-500 focus:ring-amber-500"
            />
            <span className="text-xs text-zinc-300">추세선</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-600 bg-zinc-800/60 px-3 py-1.5">
            <input
              type="checkbox"
              checked={showMovingAvg}
              onChange={(e) => setShowMovingAvg(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-zinc-500 text-cyan-500 focus:ring-cyan-500"
            />
            <span className="text-xs text-zinc-300">3개월 이동평균</span>
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.categories.map((cat, idx) => (
            <label
              key={cat}
              className="flex max-w-[7rem] cursor-pointer items-center gap-2 truncate rounded-xl border border-zinc-600 bg-zinc-800/80 px-2.5 py-1.5 transition-colors hover:bg-zinc-700/80"
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
              <span className="text-sm text-zinc-300" title={cat}>{shortCategoryLabel(cat)}</span>
            </label>
          ))}
        </div>
      </div>

      {/* 누적 영역 차트: 왼쪽 100만 이상 / 오른쪽 100만 미만 (스케일 분리) */}
      {selectedCategories.size === 0 ? (
        <div className="flex h-72 items-center justify-center rounded-xl border border-dashed border-zinc-600 bg-zinc-800/30 text-zinc-500 md:h-96">
          카테고리를 선택하세요
        </div>
      ) : (highVolCats.length > 0 && lowVolCats.length > 0) ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="min-w-0 rounded-xl border border-zinc-600 bg-zinc-800/60 p-4">
            <div className="mb-2 text-xs font-medium text-cyan-400">대량 (100만 개 이상)</div>
            <div className="h-64 w-full min-w-0 md:h-80">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartDataHigh} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    {highVolCats.map((cat, idx) => (
                      <linearGradient key={cat} id={`gradient-high-${cat}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={getColorForCategory(cat, idx)} stopOpacity={0.8} />
                        <stop offset="100%" stopColor={getColorForCategory(cat, idx)} stopOpacity={0.2} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
                  <XAxis dataKey="month" stroke="#71717a" tick={{ fill: "#a1a1aa", fontSize: 11 }} tickFormatter={(v) => (v ? String(v).slice(2) : "")} interval={0} />
                  <YAxis stroke="#71717a" tick={{ fill: "#a1a1aa", fontSize: 11 }} tickFormatter={(v) => v.toLocaleString()} />
                  <Tooltip contentStyle={{ backgroundColor: "#18181b", border: "1px solid #3f3f46", borderRadius: "8px" }} labelStyle={{ color: "#fafafa" }}
                    formatter={(value, name) => [typeof value === "number" ? value.toLocaleString() : String(value ?? "-"), shortCategoryLabel(String(name ?? ""))]}
                    labelFormatter={(label) => <span className="text-cyan-400">{label}</span>} />
                  <Legend wrapperStyle={{ paddingTop: 8 }} formatter={(value) => <span className="text-sm text-zinc-300" title={value}>{shortCategoryLabel(value)}</span>} />
                  {highVolCats.map((cat, idx) => (
                    <Area key={cat} type="monotone" dataKey={cat} stackId="1" stroke={getColorForCategory(cat, idx)} fill={`url(#gradient-high-${cat})`} strokeWidth={1.5} />
                  ))}
                  {showTrendLine && <Line type="monotone" dataKey="trend" stroke="#f59e0b" strokeWidth={2} dot={false} name="추세선" />}
                  {showMovingAvg && <Line type="monotone" dataKey="ma3" stroke="#22d3ee" strokeWidth={1.5} strokeDasharray="4 4" dot={false} name="3M평균" />}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="min-w-0 rounded-xl border border-zinc-600 bg-zinc-800/60 p-4">
            <div className="mb-2 text-xs font-medium text-amber-400">소량 (100만 개 미만)</div>
            <div className="h-64 w-full min-w-0 md:h-80">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartDataLow} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    {lowVolCats.map((cat, idx) => (
                      <linearGradient key={cat} id={`gradient-low-${cat}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={getColorForCategory(cat, data.categories.indexOf(cat))} stopOpacity={0.8} />
                        <stop offset="100%" stopColor={getColorForCategory(cat, data.categories.indexOf(cat))} stopOpacity={0.2} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
                  <XAxis dataKey="month" stroke="#71717a" tick={{ fill: "#a1a1aa", fontSize: 11 }} tickFormatter={(v) => (v ? String(v).slice(2) : "")} interval={0} />
                  <YAxis stroke="#71717a" tick={{ fill: "#a1a1aa", fontSize: 11 }} tickFormatter={(v) => v.toLocaleString()} />
                  <Tooltip contentStyle={{ backgroundColor: "#18181b", border: "1px solid #3f3f46", borderRadius: "8px" }} labelStyle={{ color: "#fafafa" }}
                    formatter={(value, name) => [typeof value === "number" ? value.toLocaleString() : String(value ?? "-"), shortCategoryLabel(String(name ?? ""))]}
                    labelFormatter={(label) => <span className="text-cyan-400">{label}</span>} />
                  <Legend wrapperStyle={{ paddingTop: 8 }} formatter={(value) => <span className="text-sm text-zinc-300" title={value}>{shortCategoryLabel(value)}</span>} />
                  {lowVolCats.map((cat, idx) => (
                    <Area key={cat} type="monotone" dataKey={cat} stackId="1" stroke={getColorForCategory(cat, data.categories.indexOf(cat))} fill={`url(#gradient-low-${cat})`} strokeWidth={1.5} />
                  ))}
                  {showTrendLine && <Line type="monotone" dataKey="trend" stroke="#f59e0b" strokeWidth={2} dot={false} name="추세선" />}
                  {showMovingAvg && <Line type="monotone" dataKey="ma3" stroke="#22d3ee" strokeWidth={1.5} strokeDasharray="4 4" dot={false} name="3M평균" />}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
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
              tickFormatter={(v) => (v ? String(v).slice(2) : "")}
              interval={0}
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
                shortCategoryLabel(String(name ?? "")),
              ]}
              labelFormatter={(label) => (
                <span className="text-cyan-400">{label}</span>
              )}
            />
            <Legend
              wrapperStyle={{ paddingTop: 8 }}
              formatter={(value) => (
                <span className="text-sm text-zinc-300" title={value}>{shortCategoryLabel(value)}</span>
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
            {showTrendLine && (
              <Line
                type="monotone"
                dataKey="trend"
                stroke="#f59e0b"
                strokeWidth={2}
                strokeDasharray="6 4"
                dot={false}
                name="추세선"
                connectNulls
              />
            )}
            {showMovingAvg && (
              <Line
                type="monotone"
                dataKey="ma3"
                stroke="#22d3ee"
                strokeWidth={2}
                strokeDasharray="4 4"
                dot={false}
                name="3개월 이동평균"
                connectNulls
              />
            )}
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
                <td className="border border-zinc-700 px-3 py-2 font-medium text-zinc-200" title={category}>
                  {shortCategoryLabel(category)}
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
