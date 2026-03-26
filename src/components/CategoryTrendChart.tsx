"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
import { useInventory } from "@/context/InventoryContext";
import { normalizeCategory, computeAvgNDayOutboundByProduct } from "@/lib/inventoryApi";
import { simplifyProductName } from "@/lib/productNameFormatter";
import { NAVER_CATEGORIES } from "@/lib/naverSearchTrend";
import {
  ComposedChart,
  Bar,
  BarChart,
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

/** 마스터 5개 카테고리만 */
const CATEGORY_COLORS: Record<string, string> = {
  마스크: "#22d3ee",
  캡슐세제: "#a78bfa",
  섬유유연제: "#f472b6",
  액상세제: "#34d399",
  생활용품: "#fbbf24",
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

/** 카테고리 표시용 짧은 이름 (마스터 5개만) */
const CATEGORY_SHORT: Record<string, string> = {
  마스크: "마스크",
  캡슐세제: "캡슐",
  섬유유연제: "섬유",
  액상세제: "액상",
  생활용품: "생활",
  "3개월 이동평균": "3M평균",
};
function shortCategoryLabel(cat: string): string {
  return CATEGORY_SHORT[cat] ?? (cat.length > 4 ? `${cat.slice(0, 4)}…` : cat);
}

export interface CategoryTrendData {
  months: string[];
  categories: string[];
  chartData: Record<string, string | number>[];
  /** 세 테이블 모두 0건일 때만 true (API) */
  sourceTablesEmpty?: boolean;
  rowCounts?: { inbound: number; outbound: number; snapshot: number };
  momRates: Record<string, Record<string, number | null>>;
  monthlyTotals?: Record<string, {
    outbound: number;
    inbound: number;
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
    thisMonthInboundByChannel?: Record<string, number>;
    /** @deprecated thisMonthInboundByChannel */
    thisMonthInboundByWarehouse?: Record<string, number>;
  };
}

/** 판매 채널별 월별 매출 막대(Recharts `data`) 한 행 */
type ChannelSalesBarRow = {
  month: string;
  쿠팡: number;
  일반: number;
  total: number;
  coupangPct: number;
  generalPct: number;
};

type YearFilter = "all" | string;

export function CategoryTrendChart() {
  const {
    categoryTrendData: contextCategoryTrend,
    categoryForecastThisMonth,
    inventoryProducts = [],
    inventoryOutbound = [],
    stockByProduct = {},
    dailyVelocityByProduct = {},
    safetyStockByProduct = {},
    isSupabaseLoading,
    categoryTrendLoaded,
    refresh,
  } = useInventory() ?? {};
  const [data, setData] = useState<CategoryTrendData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [yearFilter, setYearFilter] = useState<YearFilter>("all");
  const [showTrendLine, setShowTrendLine] = useState(false);
  const [showMovingAvg, setShowMovingAvg] = useState(false);
  const [showNaverSearch, setShowNaverSearch] = useState(true);
  const [focusedActionCategory, setFocusedActionCategory] = useState<string | null>(null);
  const safeNumber = (value: unknown): number => Number(value ?? 0) || 0;
  const renderData = {
    contextCategoryTrend,
    categoryForecastThisMonth,
    inventoryProducts,
    inventoryOutbound,
    stockByProduct,
    dailyVelocityByProduct,
    safetyStockByProduct,
    isSupabaseLoading,
    categoryTrendLoaded,
  };
  console.log("RENDER STEP", renderData);

  useEffect(() => {
    if (contextCategoryTrend) {
      const ct = contextCategoryTrend as CategoryTrendData;
      setData(ct);
      setSelectedCategories(new Set(ct?.categories ?? []));
      setError(null);
      setLoading(false);
      const catCount = ct?.categories?.length ?? 0;
      const chartLen = ct?.chartData?.length ?? 0;
      console.log("[CategoryTrendChart] 데이터 수신 | 소스: inventory_* (DB) | categories:", catCount, "| chartData rows:", chartLen);
    } else if (contextCategoryTrend === null && categoryTrendLoaded === true) {
      setData(null);
      setSelectedCategories(new Set());
      setError(null);
      setLoading(false);
      console.log("[CategoryTrendChart] context에 추세 데이터 없음");
    } else {
      setLoading(true);
    }
  }, [contextCategoryTrend, categoryTrendLoaded]);

  const toggleCategory = (cat: string) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) {
        next.delete(cat);
      } else {
        next.add(cat);
        if (NAVER_CATEGORIES.includes(cat)) setFocusedActionCategory(cat);
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
    console.log("MEMO DATA", data);
    if (!data?.months) return [];
    if (yearFilter === "all") return data.months;
    return data.months.filter((m) => m.startsWith(yearFilter));
  }, [data?.months, yearFilter]);

  const yearOptions = useMemo(() => {
    console.log("MEMO DATA", data);
    const ys = new Set<string>();
    for (const m of data?.months ?? []) {
      const y = String(m).slice(0, 4);
      if (/^\d{4}$/.test(y)) ys.add(y);
    }
    return [...ys].sort();
  }, [data?.months]);

  /**
   * 판매 채널별 월별 매출 막대용 배열.
   * `rows.push({ month, 일반: mt.outboundValueGeneral||0, 쿠팡: mt.outboundValueCoupang||0, … })` 형태로 구성
   * (API `data`는 불변이라 `data.push` 금지).
   */
  const channelSalesBarData = useMemo((): ChannelSalesBarRow[] => {
    console.log("MEMO DATA", data);
    if (!data?.monthlyTotals) return [];
    const monthsToUse =
      yearFilter === "all"
        ? (data.months ?? [])
        : (data.months ?? []).filter((m) => m.startsWith(yearFilter));
    const rows: ChannelSalesBarRow[] = [];
    for (const month of monthsToUse) {
      const mt = data.monthlyTotals[month];
      if (!mt) continue;
      const 일반 = mt.outboundValueGeneral || 0;
      const 쿠팡 = mt.outboundValueCoupang || 0;
      const total = 일반 + 쿠팡;
      rows.push({
        month,
        일반,
        쿠팡,
        total,
        coupangPct: total > 0 ? Math.round((쿠팡 / total) * 100) : 0,
        generalPct: total > 0 ? Math.round((일반 / total) * 100) : 0,
      });
    }
    return rows;
  }, [data?.monthlyTotals, data?.months, yearFilter]);

  const channelSalesKpis = useMemo(() => {
    console.log("MEMO DATA", data);
    const totalSales = channelSalesBarData.reduce((s, r) => s + r.total, 0);
    const coupangTotal = channelSalesBarData.reduce((s, r) => s + r.쿠팡, 0);
    const generalTotal = channelSalesBarData.reduce((s, r) => s + r.일반, 0);
    const cnt = (channelSalesBarData ?? []).length || 1;
    return {
      totalSales,
      coupangTotal,
      generalTotal,
      coupangAvg: Math.round(coupangTotal / cnt),
      generalAvg: Math.round(generalTotal / cnt),
      coupangShare: totalSales > 0 ? Math.round((coupangTotal / totalSales) * 100) : 0,
      generalShare: totalSales > 0 ? Math.round((generalTotal / totalSales) * 100) : 0,
      monthCount: (channelSalesBarData ?? []).length,
    };
  }, [channelSalesBarData]);

  useEffect(() => {
    if (!data?.monthlyTotals) return;
    const monthKeys = Object.keys(data.monthlyTotals).sort();
    const nonZeroMonths = monthKeys.filter((m) => {
      const mt = data.monthlyTotals?.[m];
      return (
        Number(mt?.outboundValueCoupang ?? 0) > 0 ||
        Number(mt?.outboundValueGeneral ?? 0) > 0
      );
    });
    const hasNaN =
      !Number.isFinite(channelSalesKpis.totalSales) ||
      !Number.isFinite(channelSalesKpis.coupangTotal) ||
      !Number.isFinite(channelSalesKpis.generalTotal);
    console.log("[CategoryTrendChart:channel-sales-debug]", {
      yearFilter,
      monthCountRaw: monthKeys.length,
      monthCountFiltered: channelSalesBarData.length,
      nonZeroMonths: nonZeroMonths.slice(-10),
      sampleMonthlyTotals: nonZeroMonths.slice(-3).map((m) => ({
        month: m,
        outboundValue: (data.monthlyTotals?.[m]?.outboundValueCoupang ?? 0) + (data.monthlyTotals?.[m]?.outboundValueGeneral ?? 0),
        outboundValueCoupang: data.monthlyTotals?.[m]?.outboundValueCoupang ?? 0,
        outboundValueGeneral: data.monthlyTotals?.[m]?.outboundValueGeneral ?? 0,
      })),
      kpis: channelSalesKpis,
      hasNaN,
    });
  }, [data?.monthlyTotals, yearFilter, channelSalesBarData, channelSalesKpis]);

  /** AI 예측보고 당월 예측을 반영한 chartData (다른 데이터 건드리지 않음) */
  const effectiveChartData = useMemo(() => {
    console.log("MEMO DATA", data);
    if (!data?.chartData?.length) return data?.chartData ?? [];
    const cf = categoryForecastThisMonth;
    if (!cf) return data?.chartData ?? [];
    const lastRow = data.chartData[data.chartData.length - 1] as Record<string, string | number>;
    const lastMonth = String(lastRow?.month ?? "");
    if (lastMonth !== cf.thisMonthKey) return data?.chartData ?? [];
    const merged = (data?.chartData ?? []).slice(0, -1).map((r) => ({ ...r }));
    const newLast = { ...lastRow };
    for (const [cat, val] of Object.entries(cf?.byCategory ?? {})) {
      newLast[cat] = val;
    }
    merged.push(newLast);
    return merged;
  }, [data?.chartData, categoryForecastThisMonth]);

  const filteredChartData = useMemo(() => {
    console.log("MEMO DATA", data);
    if (!effectiveChartData?.length) return [];
    let rows = effectiveChartData;
    if (yearFilter !== "all") {
      rows = rows.filter((r) => String(r.month ?? "").startsWith(yearFilter));
    }
    const base = rows.map((row) => {
      const filtered: Record<string, string | number> = { month: row.month };
      let total = 0;
      const selected = Array.from(selectedCategories);
      selected.forEach((cat) => {
        const val = (row[cat] as number) ?? 0;
        filtered[cat] = val;
        total += val;
      });
      if (selected.length === 0) {
        const monthKey = String(row.month ?? "");
        total = Number(data?.monthlyTotals?.[monthKey]?.outbound ?? 0);
      }
      Object.keys(row).filter((k) => k.startsWith("naver_")).forEach((k) => {
        const v = row[k];
        const num = typeof v === "number" ? v : parseFloat(String(v ?? 0)) || 0;
        filtered[k] = Math.min(100, Math.max(0, num));
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

    return base.map(({ _total, ...rest }) => ({ ...rest, outboundTotal: _total ?? 0 }));
  }, [effectiveChartData, selectedCategories, yearFilter]);

  const filteredMomTable = useMemo(() => {
    console.log("MEMO DATA", data);
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
    console.log("MEMO DATA", data);
    if (!effectiveChartData?.length || selectedCategories.size === 0) {
      return { highVolCats: [] as string[], lowVolCats: [] as string[], chartDataHigh: [], chartDataLow: [] };
    }
    const catTotals: Record<string, number> = {};
    for (const row of effectiveChartData) {
      for (const cat of selectedCategories) {
        catTotals[cat] = (catTotals[cat] ?? 0) + ((row[cat] as number) ?? 0);
      }
    }
    const highVolCats = Array.from(selectedCategories).filter((c) => (catTotals[c] ?? 0) >= HIGH_VOLUME_THRESHOLD);
    const lowVolCats = Array.from(selectedCategories).filter((c) => (catTotals[c] ?? 0) < HIGH_VOLUME_THRESHOLD);

    let rows = effectiveChartData;
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
        Object.keys(row).filter((k) => k.startsWith("naver_")).forEach((k) => {
          const v = row[k];
          const num = typeof v === "number" ? v : parseFloat(String(v ?? 0)) || 0;
          filtered[k] = Math.min(100, Math.max(0, num));
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
      return base.map(({ _total, ...rest }) => ({ ...rest, outboundTotal: _total ?? 0 }));
    };

    return {
      highVolCats,
      lowVolCats,
      chartDataHigh: buildChartData(highVolCats),
      chartDataLow: buildChartData(lowVolCats),
    };
  }, [effectiveChartData, selectedCategories, yearFilter]);

  /** 네이버 검색 지수 Y축 자동 스케일 (선택된 카테고리 min~max, 여유 10%) */
  const computeNaverDomain = (chartData: Record<string, string | number>[], naverCats: string[]): [number, number] => {
    if (!chartData?.length || naverCats.length === 0) return [0, 100];
    let min = Infinity;
    let max = -Infinity;
    for (const row of chartData) {
      for (const cat of naverCats) {
        const v = (row[`naver_${cat}`] as number) ?? 0;
        if (typeof v === "number" && !isNaN(v)) {
          min = Math.min(min, v);
          max = Math.max(max, v);
        }
      }
    }
    if (min === Infinity || max === -Infinity) return [0, 100];
    const padding = Math.max((max - min) * 0.1, 2);
    const domainMin = Math.max(0, min - padding);
    const domainMax = Math.min(100, max + padding);
    return min === max ? [Math.max(0, min - 5), Math.min(100, max + 5)] : [domainMin, domainMax];
  };

  const naverDomainHigh = useMemo(() => {
    console.log("MEMO DATA", data);
    return computeNaverDomain(chartDataHigh, highVolCats.filter((c) => NAVER_CATEGORIES.includes(c)));
  }, [chartDataHigh, highVolCats, data]);
  const naverDomainLow = useMemo(() => {
    console.log("MEMO DATA", data);
    return computeNaverDomain(chartDataLow, lowVolCats.filter((c) => NAVER_CATEGORIES.includes(c)));
  }, [chartDataLow, lowVolCats, data]);
  const naverDomainSingle = useMemo(() => {
    console.log("MEMO DATA", data);
    return computeNaverDomain(
      filteredChartData,
      Array.from(selectedCategories).filter((c) => NAVER_CATEGORIES.includes(c))
    );
  }, [filteredChartData, selectedCategories, data]);

  /** 검색어-판매량 상관계수 + 액션플랜 (월별 데이터 1:1 매칭) */
  const correlationAnalysis = useMemo(() => {
    console.log("MEMO DATA", data);
    if (!effectiveChartData?.length || selectedCategories.size === 0) return [];
    const naverCats = NAVER_CATEGORIES.filter((c) => selectedCategories.has(c));
    if (naverCats.length === 0) return [];

    let rows = effectiveChartData;
    if (yearFilter !== "all") rows = rows.filter((r) => String(r.month ?? "").startsWith(yearFilter));

    const pearson = (x: number[], y: number[]): number => {
      const n = Math.min(x.length, y.length);
      if (n < 3) return 0;
      const xm = x.slice(0, n).reduce((a, b) => a + b, 0) / n;
      const ym = y.slice(0, n).reduce((a, b) => a + b, 0) / n;
      let num = 0, dx2 = 0, dy2 = 0;
      for (let i = 0; i < n; i++) {
        const dx = x[i] - xm, dy = y[i] - ym;
        num += dx * dy;
        dx2 += dx * dx;
        dy2 += dy * dy;
      }
      const den = Math.sqrt(dx2 * dy2);
      return den > 0 ? num / den : 0;
    };

    const recentAvg = (arr: number[], k: number) => {
      const slice = arr.slice(-k).filter((v) => v > 0);
      return slice.length > 0 ? slice.reduce((a, b) => a + b, 0) / slice.length : 0;
    };

    return naverCats.map((cat) => {
      const searchVals = rows.map((r) => (r[`naver_${cat}`] as number) ?? 0);
      const salesVals = rows.map((r) => (r[cat] as number) ?? 0);
      let bestR = pearson(searchVals, salesVals);
      let bestLag = 0;
      for (let lag = 1; lag <= 2; lag++) {
        const r = pearson(searchVals.slice(0, -lag), salesVals.slice(lag));
        if (Math.abs(r) > Math.abs(bestR)) {
          bestR = r;
          bestLag = lag;
        }
      }
      const lagText = bestLag === 0 ? "동시" : bestLag === 1 ? "1개월 선행" : "2개월 선행";
      const pct = Math.round(Math.abs(bestR) * 100);
      const corrHigh = pct >= 70;
      const corrLow = pct < 50;

      const recentSearch = recentAvg(searchVals, 2);
      const prevSearch = recentAvg(searchVals.slice(0, -2), 2);
      const searchUp = recentSearch > prevSearch;
      const searchDown = recentSearch < prevSearch && prevSearch > 0;

      const recentSales = recentAvg(salesVals, 2);
      const prevSales = recentAvg(salesVals.slice(0, -2), 2);
      const salesUp = recentSales > prevSales;
      const salesDown = recentSales < prevSales && prevSales > 0;

      let actionType: "공격형" | "방어형" | "점검형" = "점검형";
      let actionMessage = "검색어와 판매량이 따로 움직입니다. 외부 요인(광고, 가격 경쟁)을 점검하세요. 시장 트렌드보다는 내부 프로모션 영향이 큽니다.";
      let actionColor = "amber";

      if (corrLow) {
        actionType = "점검형";
        actionMessage = "검색어와 판매량이 따로 움직입니다. 외부 요인(광고, 가격 경쟁)을 점검하세요. 시장 트렌드보다는 내부 프로모션 영향이 큽니다.";
        actionColor = "amber";
      } else if (corrHigh) {
        if (searchUp && salesUp) {
          actionType = "공격형";
          actionMessage = "전 키워드 검색량 동반 상승 중입니다. 1개월 뒤 품절 위험 80%! 즉시 추가 발주를 검토하세요.";
          actionColor = "emerald";
        } else if (searchDown && salesUp) {
          actionType = "방어형";
          actionMessage = "판매량은 높으나 네이버 관심도가 꺾였습니다. 다음 달 재고 과잉 위험! 신규 발주를 멈추고 재고 소진에 집중하세요.";
          actionColor = "rose";
        } else {
          actionType = "점검형";
          actionMessage = "검색어와 판매량이 따로 움직입니다. 외부 요인(광고, 가격 경쟁)을 점검하세요. 시장 트렌드보다는 내부 프로모션 영향이 큽니다.";
          actionColor = "amber";
        }
      }

      const showDataMismatchWarning = actionType === "방어형";

      return {
        category: cat,
        correlation: bestR,
        lag: bestLag,
        lagText,
        actionType,
        actionMessage,
        actionColor,
          showDataMismatchWarning,
      };
    });
  }, [effectiveChartData, selectedCategories, yearFilter]);

  useEffect(() => {
    if (focusedActionCategory && correlationAnalysis.length > 0 && !correlationAnalysis.some((a) => a.category === focusedActionCategory)) {
      setFocusedActionCategory(null);
    }
  }, [focusedActionCategory, correlationAnalysis]);

  /** 카테고리별 재고 부족 분석 (보유 일수 기준: 품절임박 ≤3일, 부족 <14일) */
  const shortageByCategory = useMemo(() => {
    console.log("MEMO DATA", data);
    const out: Record<string, { low: number; out: number }> = {};
    for (const cat of NAVER_CATEGORIES) out[cat] = { low: 0, out: 0 };
    if ((inventoryProducts ?? []).length === 0 || Object.keys(stockByProduct ?? {}).length === 0) return out;
    for (const p of inventoryProducts) {
      const raw = String(p.category ?? p.group_name ?? "").trim();
      const pCat = normalizeCategory(raw) || raw;
      if (!NAVER_CATEGORIES.includes(pCat)) continue;
      const stock = Math.max(0, stockByProduct[p.product_code] ?? stockByProduct[String(p.product_code).trim()] ?? 0);
      const dailyVel = dailyVelocityByProduct[p.product_code] ?? dailyVelocityByProduct[String(p.product_code).trim()] ?? 0;
      if (dailyVel <= 0) continue;
      const daysOfStock = stock / dailyVel;
      if (daysOfStock <= 3) out[pCat].out++;
      else if (daysOfStock < 14) out[pCat].low++;
    }
    return out;
  }, [inventoryProducts, stockByProduct, dailyVelocityByProduct]);

  /** 품목별 누적 출고 기반 일평균 (최근 30일) → 3일 판매량 산출용 */
  const dailyVelFromOutbound = useMemo(() => {
    console.log("MEMO DATA", data);
    return computeAvgNDayOutboundByProduct(inventoryOutbound, 30);
  }, [inventoryOutbound, data]);

  /** 카테고리별 재고 부족으로 인한 판매 손실 (누적 출고 기반 3일 판매량, 품절임박 3일 이하만) */
  const MAX_SHORTAGE_SKUS = 8;
  const DAYS_FOR_LOSS = 3;
  const shortageLostByCategory = useMemo(() => {
    console.log("MEMO DATA", data);
    type SkuRow = { label: string; code: string; pack_size?: number; lost: number; actual: number; potential: number };
    const out: Record<string, { pct: number; totalLost: number; skus: SkuRow[] }> = {};
    for (const cat of NAVER_CATEGORIES) out[cat] = { pct: 0, totalLost: 0, skus: [] };
    if (!effectiveChartData?.length || (inventoryProducts ?? []).length === 0) return out;
    const lastRow = effectiveChartData[effectiveChartData.length - 1] as Record<string, string | number>;
    const lastMonth = String(lastRow?.month ?? "");
    if (!lastMonth) return out;
    const skusByCat: Record<string, SkuRow[]> = {};
    for (const cat of NAVER_CATEGORIES) skusByCat[cat] = [];
    for (const p of inventoryProducts) {
      const raw = String(p.category ?? p.group_name ?? "").trim();
      const pCat = normalizeCategory(raw) || raw;
      if (!NAVER_CATEGORIES.includes(pCat)) continue;
      const stock = Math.max(0, stockByProduct[p.product_code] ?? stockByProduct[String(p.product_code).trim()] ?? 0);
      const dailyVel = dailyVelFromOutbound[p.product_code] ?? dailyVelFromOutbound[String(p.product_code).trim()] ?? dailyVelocityByProduct[p.product_code] ?? dailyVelocityByProduct[String(p.product_code).trim()] ?? 0;
      if (dailyVel <= 0) continue;
      const daysOfStock = stock / dailyVel;
      if (daysOfStock > DAYS_FOR_LOSS) continue; // 품절임박(3일 이하)만 손실 집계
      const potential = dailyVel * DAYS_FOR_LOSS; // 3일 판매량 = 일평균 × 3
      const actual = dailyVel * daysOfStock; // 3일 중 재고로 판매 가능했던 수량
      const lost = Math.max(0, potential - actual);
      if (lost <= 0) continue;
      const label = String(p.product_name ?? p.product_code ?? "").trim() || String(p.product_code ?? "");
      skusByCat[pCat].push({ label, code: String(p.product_code ?? ""), pack_size: p.pack_size, lost, actual, potential });
    }
    for (const cat of NAVER_CATEGORIES) {
      const categoryActual = (lastRow[cat] as number) ?? 0;
      const list = skusByCat[cat] ?? [];
      list.sort((a, b) => b.lost - a.lost);
      const totalLost = list.reduce((s, t) => s + t.lost, 0);
      const skus = list.slice(0, MAX_SHORTAGE_SKUS);
      const pct = categoryActual + totalLost > 0 ? Math.round((totalLost / (categoryActual + totalLost)) * 1000) / 10 : 0;
      out[cat] = { pct, totalLost, skus };
    }
    return out;
  }, [effectiveChartData, inventoryProducts, stockByProduct, dailyVelocityByProduct, dailyVelFromOutbound]);

  /** 네이버 검색 지수 변화율 기반 액션플랜 (전월 대비 MoM + 작년 동월 대비 YoY) */
  const naverIndexActionPlans = useMemo(() => {
    console.log("MEMO DATA", data);
    if (!effectiveChartData?.length || selectedCategories.size === 0) return [];
    const naverCats = NAVER_CATEGORIES.filter((c) => selectedCategories.has(c));
    if (naverCats.length === 0) return [];

    let rows = effectiveChartData;
    if (yearFilter !== "all") rows = rows.filter((r) => String(r.month ?? "").startsWith(yearFilter));
    if ((rows ?? []).length < 2) return [];

    const lastRow = rows[rows.length - 1] as Record<string, string | number>;
    const prevRow = rows[rows.length - 2] as Record<string, string | number>;
    const lastMonth = String(lastRow.month ?? "");
    const [y, m] = lastMonth.split("-").map(Number);
    const lastYearSameMonth = `${y - 1}-${String(m).padStart(2, "0")}`;
    const yoyRow = effectiveChartData.find((r) => String(r.month ?? "") === lastYearSameMonth) as Record<string, string | number> | undefined;

    return naverCats.map((cat) => {
      const currVal = (lastRow[`naver_${cat}`] as number) ?? 0;
      const prevVal = (prevRow[`naver_${cat}`] as number) ?? 0;
      const lastYearVal = yoyRow ? ((yoyRow[`naver_${cat}`] as number) ?? 0) : 0;

      const currSales = (lastRow[cat] as number) ?? 0;
      const prevSales = (prevRow[cat] as number) ?? 0;

      const changeRate = prevVal > 0 ? ((currVal - prevVal) / prevVal) * 100 : 0;
      const changeRateRounded = Math.round(changeRate * 10) / 10;

      const salesChangeRate = prevSales > 0 ? ((currSales - prevSales) / prevSales) * 100 : 0;
      const salesChangeRounded = Math.round(salesChangeRate * 10) / 10;

      const changeRateYoY = lastYearVal > 0 ? ((currVal - lastYearVal) / lastYearVal) * 100 : 0;
      const changeRateYoYRounded = Math.round(changeRateYoY * 10) / 10;

      const corrItem = correlationAnalysis.find((a) => a.category === cat);
      const lag = corrItem?.lag ?? 0;
      const lagText = lag === 0 ? "동시" : `${lag}개월 선행`;
      const impactMonths = lag === 0 ? 1 : lag;

      const searchUp = changeRate > 0;
      const searchDown = changeRate < 0;
      const salesUp = salesChangeRate > 0;
      const salesDown = salesChangeRate < 0;

      let variant: "하락" | "상승" | "보합" = "보합";
      let message = "";
      let cardColor = "zinc";

      if (searchDown && salesDown) {
        variant = "하락";
        cardColor = "rose";
        message = `⚠️ [재고 방어] 검색량·판매량 동반 감소. ${lagText} 지표로 ${impactMonths}개월 뒤 출고량 감소 예상. 발주량 20% 이상 하향 조정하세요.`;
      } else if (searchUp && salesUp) {
        variant = "상승";
        cardColor = "emerald";
        message = `🚀 [공격적 확보] 검색량·판매량 동반 상승(전월 판매 +${salesChangeRounded}%). 발주량 10~15% 확보하세요.`;
      } else if (searchUp && salesDown) {
        variant = "보합";
        cardColor = "amber";
        const shortage = shortageByCategory[cat] ?? { low: 0, out: 0 };
        const hasShortage = shortage.out > 0 || shortage.low > 0;
        const lostPct = shortageLostByCategory[cat]?.pct ?? 0;
        message = hasShortage
          ? `⚠️ [점검 필요] 검색량은 상승인데 판매량은 감소(전월 ${salesChangeRounded}%). 재고 부족으로 추정 손실 약 ${lostPct}%. 하단 결품 손실 테이블 참조.`
          : `⚠️ [점검 필요] 검색량은 상승인데 판매량은 감소(전월 ${salesChangeRounded}%). 프로모션·가격·경쟁 등 원인 점검 후 발주 결정하세요.`;
      } else if (searchDown && salesUp) {
        variant = "보합";
        cardColor = "zinc";
        message = `✔ [현상 유지] 검색은 하락인데 판매는 상승. 프로모션 영향 가능. 발주량 유지, 과다 재고 금지.`;
      } else {
        variant = "보합";
        cardColor = "zinc";
        message = `✔ [현상 유지] 검색·판매 변화 미미. 발주량 유지하세요.`;
      }

      return {
        category: cat,
        changeRate: changeRateRounded,
        changeRateYoY: changeRateYoYRounded,
        currVal,
        prevVal,
        lastYearVal,
        variant,
        message,
        cardColor,
      };
    });
  }, [effectiveChartData, selectedCategories, yearFilter, correlationAnalysis, shortageByCategory, shortageLostByCategory]);

  if (loading) {
    return (
      <div className="mt-8 rounded-2xl border border-zinc-700 bg-zinc-900/50 p-8 text-center md:mt-10">
        <p className="text-zinc-500">카테고리별 판매 동향을 불러오는 중…</p>
        <p className="mt-2 text-xs text-zinc-600">15초 이상 걸리면 새로고침 후 다시 시도하세요.</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mt-8 rounded-2xl border border-red-500/40 bg-red-500/10 p-6 text-center md:mt-10">
        <p className="text-red-400">{error ?? "데이터를 불러올 수 없습니다."}</p>
        <button
          type="button"
          onClick={() => refresh?.()}
          className="mt-3 rounded-lg bg-red-500/20 px-4 py-2 text-sm text-red-300 hover:bg-red-500/30"
        >
          다시 시도
        </button>
      </div>
    );
  }

  const hasMonths = (data.months?.length ?? 0) > 0;
  const rc = data.rowCounts;
  const tablesAllEmpty =
    data.sourceTablesEmpty === true ||
    (rc != null && rc.inbound === 0 && rc.outbound === 0 && rc.snapshot === 0);

  if (tablesAllEmpty) {
    return (
      <div className="mt-8 rounded-2xl border border-zinc-700 bg-zinc-900/50 p-8 text-center text-zinc-500 md:mt-10">
        출고·입고·재고 원본 데이터가 없어 차트를 표시할 수 없습니다.
      </div>
    );
  }

  if (!hasMonths) {
    return (
      <div className="mt-8 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-8 text-center text-amber-200/90 md:mt-10">
        원본 행은 있으나 유효한 월 축을 만들 수 없습니다. 날짜 컬럼 형식을 확인하세요.
      </div>
    );
  }

  const mom = data.momIndicators;

  return (
        <div className="mt-8 min-w-0 space-y-6 overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900/80 p-4 md:mt-10 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-white md:text-xl">
          카테고리별 월별 판매 동향
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            연도
          </span>
          {["all", ...yearOptions].map((y) => (
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
                  {avgDelta >= 0 ? "+" : ""}{safeNumber(avgDelta).toLocaleString()}EA
                </span>
              </div>
            </div>
            <div className="h-56 w-full min-w-0 md:h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={invChangeData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
                  <XAxis dataKey="month" stroke="#71717a" tick={{ fill: "#a1a1aa", fontSize: 11 }} tickFormatter={(v) => (v ? String(v).slice(2) : "")} />
                  <YAxis stroke="#71717a" tick={{ fill: "#a1a1aa", fontSize: 11 }} tickFormatter={(v) => safeNumber(v).toLocaleString()} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#18181b", border: "1px solid #3f3f46", borderRadius: "8px" }}
                    formatter={(value) => (value != null ? Number(value).toLocaleString() : "")}
                    labelFormatter={(label) => <span className="text-cyan-400">{label}</span>}
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const p = payload[0]?.payload as { delta: number; 입고: number; 출고: number };
                      return (
                        <div className="rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2 text-xs">
                          <div className="font-medium text-cyan-400">{label}</div>
                          <div>입고: {safeNumber(p?.입고).toLocaleString()}EA</div>
                          <div>출고: {safeNumber(p?.출고).toLocaleString()}EA</div>
                          <div className={p.delta >= 0 ? "text-emerald-400" : "text-rose-400"}>
                            증감: {safeNumber(p?.delta) >= 0 ? "+" : ""}{safeNumber(p?.delta).toLocaleString()}EA
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

      {/* 판매 채널별 월별 매출 금액 (쿠팡 / 일반) — `channelSalesBarData`는 useMemo에서 rows.push로 구성 */}
      {channelSalesBarData.length > 0 && (() => {
        const {
          totalSales,
          coupangAvg,
          generalAvg,
          coupangShare,
          generalShare,
          monthCount,
        } = channelSalesKpis;
        const COUPANG_COLOR = "#f97316";
        const GENERAL_COLOR = "#3b82f6";
        return (
          <div className="rounded-xl border border-zinc-600 bg-zinc-800/60 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-cyan-400">판매 채널별 월별 매출 금액</h3>
                <p className="mt-0.5 text-[10px] text-zinc-500">
                  쿠팡 vs 일반(외) · 막대 합계·툴팁 총액은 (쿠팡+일반) 채널별 월 합
                </p>
              </div>
            </div>
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-zinc-600 bg-zinc-900/80 px-3 py-2">
                <div className="text-[10px] text-zinc-500">총 매출</div>
                <div className="text-sm font-bold tabular-nums text-white">₩{safeNumber(totalSales).toLocaleString()}</div>
              </div>
              <div className="rounded-lg border border-zinc-600 bg-zinc-900/80 px-3 py-2">
                <div className="text-[10px] text-zinc-500">쿠팡 월평균</div>
                <div className="text-sm font-bold tabular-nums" style={{ color: COUPANG_COLOR }}>₩{safeNumber(coupangAvg).toLocaleString()}</div>
                <div className="text-[10px] text-zinc-500">{coupangShare}% 비중</div>
              </div>
              <div className="rounded-lg border border-zinc-600 bg-zinc-900/80 px-3 py-2">
                <div className="text-[10px] text-zinc-500">일반 월평균</div>
                <div className="text-sm font-bold tabular-nums" style={{ color: GENERAL_COLOR }}>₩{safeNumber(generalAvg).toLocaleString()}</div>
                <div className="text-[10px] text-zinc-500">{generalShare}% 비중</div>
              </div>
              <div className="rounded-lg border border-zinc-600 bg-zinc-900/80 px-3 py-2">
                <div className="text-[10px] text-zinc-500">기간</div>
                <div className="text-sm font-medium text-zinc-300">{monthCount}개월</div>
              </div>
            </div>
            <div className="h-56 w-full min-w-0 md:h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={channelSalesBarData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
                  <XAxis dataKey="month" stroke="#71717a" tick={{ fill: "#a1a1aa", fontSize: 11 }} tickFormatter={(v) => (v ? String(v).slice(2) : "")} />
                  <YAxis stroke="#71717a" tick={{ fill: "#a1a1aa", fontSize: 11 }} tickFormatter={(v) => `₩${(v / 10000).toFixed(0)}만`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#18181b", border: "1px solid #3f3f46", borderRadius: "8px" }}
                    formatter={(value) => [`₩${(value != null ? Number(value) : 0).toLocaleString()}`, ""]}
                    labelFormatter={(label) => <span className="text-cyan-400">{label}</span>}
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const p = payload[0]?.payload as { month: string; 쿠팡: number; 일반: number; total: number; coupangPct: number; generalPct: number };
                      return (
                        <div className="rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2 text-xs min-w-[180px]">
                          <div className="font-medium text-cyan-400">{label}</div>
                          <div className="mt-1 font-semibold text-white">총 ₩{safeNumber(p?.total).toLocaleString()}</div>
                          <div className="mt-1 flex justify-between gap-4">
                            <span style={{ color: COUPANG_COLOR }}>쿠팡</span>
                            <span>₩{safeNumber(p?.쿠팡).toLocaleString()} ({safeNumber(p?.coupangPct)}%)</span>
                          </div>
                          <div className="flex justify-between gap-4">
                            <span style={{ color: GENERAL_COLOR }}>일반</span>
                            <span>₩{safeNumber(p?.일반).toLocaleString()} ({safeNumber(p?.generalPct)}%)</span>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Legend formatter={(value) => (
                    <span className="text-sm" style={{ color: value === "쿠팡" ? COUPANG_COLOR : GENERAL_COLOR }}>{value}</span>
                  )} />
                  <Bar dataKey="쿠팡" fill={COUPANG_COLOR} radius={[4, 4, 0, 0]} minPointSize={2} />
                  <Bar dataKey="일반" fill={GENERAL_COLOR} radius={[4, 4, 0, 0]} minPointSize={2} />
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
                    formatter={(value) => [`₩${(value != null ? Number(value) : 0).toLocaleString()}`, ""]}
                    labelFormatter={(label) => <span className="text-cyan-400">{label}</span>}
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const p = payload[0]?.payload as Record<string, string | number>;
                      const cats = (data?.categories ?? []).filter((c) => (safeNumber(p?.[c])) > 0);
                      return (
                        <div className="rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2 text-xs">
                          <div className="font-medium text-cyan-400">{label}</div>
                          <div className="mt-1 font-semibold text-white">총 ₩{safeNumber(p?.total).toLocaleString()}</div>
                          {cats.map((cat) => (
                            <div key={cat} className="flex justify-between gap-4">
                              <span style={{ color: getColorForCategory(cat, (data?.categories ?? []).indexOf(cat)) }}>{shortCategoryLabel(cat)}</span>
                              <span>₩{safeNumber(p?.[cat]).toLocaleString()}</span>
                            </div>
                          ))}
                        </div>
                      );
                    }}
                  />
                  <Legend formatter={(value) => <span className="text-sm text-zinc-300" title={value}>{shortCategoryLabel(value)}</span>} />
                  {(data?.categories ?? []).map((cat, idx) => (
                    <Bar key={cat} dataKey={cat} stackId="value" fill={getColorForCategory(cat, idx)} radius={idx === (data?.categories ?? []).length - 1 ? [4, 4, 0, 0] : 0} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })()}

      {/* 주요 지표 + 전월 대비 증감율 */}
      {mom && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-zinc-500">데이터가 안 바뀌면</span>
            <button
              type="button"
              onClick={() => refresh?.()}
              className="rounded-lg bg-cyan-500/20 px-3 py-1.5 text-xs font-medium text-cyan-300 ring-1 ring-cyan-500/50 hover:bg-cyan-500/30"
            >
              전체 새로고침
            </button>
          </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-xl border border-zinc-700 bg-zinc-800/80 p-4">
            <div className="text-xs font-medium uppercase tracking-wider text-zinc-500">이번 달 총 판매</div>
            <div className="mt-1 flex flex-wrap items-baseline gap-2">
              <span className="text-xl font-bold tabular-nums text-white md:text-2xl">
                {safeNumber(mom?.thisMonthOutbound).toLocaleString()}EA
              </span>
              {safeNumber(mom?.thisMonthOutboundValue) > 0 && (
                <span className="text-sm text-cyan-400">
                  ₩{safeNumber(mom?.thisMonthOutboundValue).toLocaleString()}
                </span>
              )}
              {mom.outbound != null && (
                <span className={`flex items-center text-sm font-medium ${mom.outbound >= 0 ? "text-red-400" : "text-blue-400"}`}>
                  {mom.outbound >= 0 ? "▲" : "▼"} {Math.abs(mom.outbound)}%
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 text-[11px] text-zinc-400">
              <span>쿠팡: {safeNumber(mom?.thisMonthOutboundCoupang).toLocaleString()}EA</span>
              <span>일반: {safeNumber(mom?.thisMonthOutboundGeneral).toLocaleString()}EA</span>
            </div>
            <div className="mt-0.5 text-[10px] text-zinc-500">1일~오늘 누적 · 전월 대비</div>
          </div>
          <div className="rounded-xl border border-zinc-700 bg-zinc-800/80 p-4">
            <div className="text-xs font-medium uppercase tracking-wider text-zinc-500">이번 달 총 입고</div>
            <div className="mt-1 flex flex-wrap items-baseline gap-2">
              <span className="text-xl font-bold tabular-nums text-white md:text-2xl">
                {safeNumber(mom?.thisMonthInbound).toLocaleString()}EA
              </span>
              {safeNumber(mom?.thisMonthInboundValue) > 0 && (
                <span className="text-sm text-cyan-400">
                  ₩{safeNumber(mom?.thisMonthInboundValue).toLocaleString()}
                </span>
              )}
              {mom.inbound != null && (
                <span className={`flex items-center text-sm font-medium ${mom.inbound >= 0 ? "text-red-400" : "text-blue-400"}`}>
                  {mom.inbound >= 0 ? "▲" : "▼"} {Math.abs(mom.inbound)}%
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 text-[11px] text-zinc-400">
              {Object.entries(mom?.thisMonthInboundByChannel ?? mom?.thisMonthInboundByWarehouse ?? {}).length > 0
                ? Object.entries(mom?.thisMonthInboundByChannel ?? mom?.thisMonthInboundByWarehouse ?? {})
                    .sort(([, a], [, b]) => b - a)
                    .map(([ch, qty]) => (
                      <span key={ch}>{ch}: {safeNumber(qty).toLocaleString()}EA</span>
                    ))
                : <span>채널별 데이터 없음</span>}
            </div>
            <div className="mt-0.5 text-[10px] text-zinc-500">입고처 → 판매채널(쿠팡/일반) 기준 · 1일~오늘 누적 · 전월 대비</div>
          </div>
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
            <span className="text-xs text-zinc-300">추세선 (분석용)</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-600 bg-zinc-800/60 px-3 py-1.5">
            <input
              type="checkbox"
              checked={showMovingAvg}
              onChange={(e) => setShowMovingAvg(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-zinc-500 text-cyan-500 focus:ring-cyan-500"
            />
            <span className="text-xs text-zinc-300">3M평균 (분석용)</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-600 bg-zinc-800/60 px-3 py-1.5">
            <input
              type="checkbox"
              checked={showNaverSearch}
              onChange={(e) => setShowNaverSearch(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-zinc-500 text-slate-400 focus:ring-slate-400"
            />
            <span className="text-xs text-zinc-300">네이버 검색 트렌드 표시</span>
          </label>
        </div>
        <div className="flex overflow-x-auto gap-2 pb-1 -mx-1 px-1 md:overflow-visible md:mx-0 md:px-0 touch-pan-x">
          {(data?.categories ?? []).map((cat, idx) => (
            <label
              key={cat}
              className="flex shrink-0 max-w-[7rem] cursor-pointer items-center gap-2 truncate rounded-xl border border-zinc-600 bg-zinc-800/80 px-2.5 py-1.5 transition-colors hover:bg-zinc-700/80"
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
      {(selectedCategories.size > 0 && highVolCats.length > 0 && lowVolCats.length > 0) ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="min-w-0 rounded-xl border border-zinc-600 bg-zinc-800/60 p-4">
            <div className="mb-2 text-xs font-medium text-cyan-400">대량 (100만 개 이상)</div>
            <div className="overflow-x-auto overscroll-x-contain touch-pan-x -mx-2 px-2 md:mx-0 md:px-0">
              <div className="h-64 min-w-[520px] w-full md:h-80 md:min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartDataHigh} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
                  <XAxis dataKey="month" stroke="#71717a" tick={{ fill: "#a1a1aa", fontSize: 11 }} tickFormatter={(v) => (v ? String(v).slice(2) : "")} interval={0} />
                  <YAxis stroke="#71717a" tick={{ fill: "#a1a1aa", fontSize: 11 }} tickFormatter={(v) => safeNumber(v).toLocaleString()} />
                  <YAxis yAxisId="search" orientation="right" stroke="#94a3b8" tick={{ fill: "#94a3b8", fontSize: 10 }} domain={naverDomainHigh} allowDataOverflow name="월간평균" />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#18181b", border: "1px solid #3f3f46", borderRadius: "8px", minWidth: 240 }}
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length || !label) return null;
                      const p = payload[0]?.payload as Record<string, string | number>;
                      const outboundCats = highVolCats.filter((c) => !String(c).startsWith("naver_"));
                      const naverCats = highVolCats.filter((c) => NAVER_CATEGORIES.includes(c));
                      return (
                        <div className="rounded-lg border border-zinc-600 bg-zinc-900 px-4 py-3">
                          <div className="mb-3 text-base font-bold text-cyan-400">{label}</div>
                          <div className="space-y-3">
                            <div>
                              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">판매량</div>
                              {outboundCats.map((cat) => (
                                <div key={cat} className="flex justify-between gap-6 text-sm" style={{ color: getColorForCategory(cat, data.categories.indexOf(cat)) }}>
                                  <span>{shortCategoryLabel(cat)}</span>
                                  <span className="tabular-nums font-semibold text-white">{safeNumber(p?.[cat]).toLocaleString()} EA</span>
                                </div>
                              ))}
                            </div>
                            {showNaverSearch && naverCats.length > 0 && (
                              <div>
                                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">네이버 검색 지수</div>
                                {naverCats.map((cat) => {
                                  const raw = p[`naver_${cat}`];
                                  const num = typeof raw === "number" ? raw : parseFloat(String(raw ?? ""));
                                  const display = !isNaN(num) ? Math.round(num) : "-";
                                  return (
                                    <div key={cat} className="flex justify-between gap-6 text-sm font-semibold" style={{ color: getColorForCategory(cat, data.categories.indexOf(cat)) }}>
                                      <span>{cat}</span>
                                      <span className="tabular-nums text-white">{display}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Legend wrapperStyle={{ paddingTop: 8 }} formatter={(value) => <span className="text-sm text-zinc-300" title={value}>{String(value).startsWith("naver_") ? `네이버 ${String(value ?? "").replace("naver_", "")}` : value === "outboundTotal" ? "출고량" : shortCategoryLabel(value)}</span>} />
                  <Bar dataKey="outboundTotal" fill="#52525b" fillOpacity={0.35} radius={[4, 4, 0, 0]} name="출고량" />
                  {showTrendLine && <Line type="monotone" dataKey="trend" stroke="#f59e0b" strokeWidth={1} strokeDasharray="4 4" dot={false} name="추세선" />}
                  {showMovingAvg && <Line type="monotone" dataKey="ma3" stroke="#64748b" strokeWidth={1} strokeDasharray="4 4" dot={false} name="3M평균" />}
                  {showNaverSearch && highVolCats.filter((c) => NAVER_CATEGORIES.includes(c)).map((cat) => (
                    <Line key={cat} type="monotone" dataKey={`naver_${cat}`} yAxisId="search" stroke={getColorForCategory(cat, data.categories.indexOf(cat))} strokeWidth={3} dot={{ r: 3 }} name={`naver_${cat}`} />
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
              </div>
            </div>
          </div>
          <div className="min-w-0 rounded-xl border border-zinc-600 bg-zinc-800/60 p-4">
            <div className="mb-2 text-xs font-medium text-amber-400">소량 (100만 개 미만)</div>
            <div className="overflow-x-auto overscroll-x-contain touch-pan-x -mx-2 px-2 md:mx-0 md:px-0">
              <div className="h-64 min-w-[520px] w-full md:h-80 md:min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartDataLow} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
                  <XAxis dataKey="month" stroke="#71717a" tick={{ fill: "#a1a1aa", fontSize: 11 }} tickFormatter={(v) => (v ? String(v).slice(2) : "")} interval={0} />
                  <YAxis stroke="#71717a" tick={{ fill: "#a1a1aa", fontSize: 11 }} tickFormatter={(v) => safeNumber(v).toLocaleString()} />
                  <YAxis yAxisId="search" orientation="right" stroke="#94a3b8" tick={{ fill: "#94a3b8", fontSize: 10 }} domain={naverDomainLow} allowDataOverflow name="월간평균" />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#18181b", border: "1px solid #3f3f46", borderRadius: "8px", minWidth: 240 }}
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length || !label) return null;
                      const p = payload[0]?.payload as Record<string, string | number>;
                      const outboundCats = lowVolCats.filter((c) => !String(c).startsWith("naver_"));
                      const naverCats = lowVolCats.filter((c) => NAVER_CATEGORIES.includes(c));
                      return (
                        <div className="rounded-lg border border-zinc-600 bg-zinc-900 px-4 py-3">
                          <div className="mb-3 text-base font-bold text-cyan-400">{label}</div>
                          <div className="space-y-3">
                            <div>
                              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">판매량</div>
                              {outboundCats.map((cat) => (
                                <div key={cat} className="flex justify-between gap-6 text-sm" style={{ color: getColorForCategory(cat, data.categories.indexOf(cat)) }}>
                                  <span>{shortCategoryLabel(cat)}</span>
                                  <span className="tabular-nums font-semibold text-white">{safeNumber(p?.[cat]).toLocaleString()} EA</span>
                                </div>
                              ))}
                            </div>
                            {showNaverSearch && naverCats.length > 0 && (
                              <div>
                                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">네이버 검색 지수</div>
                                {naverCats.map((cat) => {
                                  const raw = p[`naver_${cat}`];
                                  const num = typeof raw === "number" ? raw : parseFloat(String(raw ?? ""));
                                  const display = !isNaN(num) ? Math.round(num) : "-";
                                  return (
                                    <div key={cat} className="flex justify-between gap-6 text-sm font-semibold" style={{ color: getColorForCategory(cat, data.categories.indexOf(cat)) }}>
                                      <span>{cat}</span>
                                      <span className="tabular-nums text-white">{display}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Legend wrapperStyle={{ paddingTop: 8 }} formatter={(value) => <span className="text-sm text-zinc-300" title={value}>{String(value).startsWith("naver_") ? `네이버 ${String(value ?? "").replace("naver_", "")}` : value === "outboundTotal" ? "출고량" : shortCategoryLabel(value)}</span>} />
                  <Bar dataKey="outboundTotal" fill="#52525b" fillOpacity={0.35} radius={[4, 4, 0, 0]} name="출고량" />
                  {showTrendLine && <Line type="monotone" dataKey="trend" stroke="#f59e0b" strokeWidth={1} strokeDasharray="4 4" dot={false} name="추세선" />}
                  {showMovingAvg && <Line type="monotone" dataKey="ma3" stroke="#64748b" strokeWidth={1} strokeDasharray="4 4" dot={false} name="3M평균" />}
                  {showNaverSearch && lowVolCats.filter((c) => NAVER_CATEGORIES.includes(c)).map((cat) => (
                    <Line key={cat} type="monotone" dataKey={`naver_${cat}`} yAxisId="search" stroke={getColorForCategory(cat, data.categories.indexOf(cat))} strokeWidth={3} dot={{ r: 3 }} name={`naver_${cat}`} />
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto overscroll-x-contain touch-pan-x -mx-2 px-2 md:mx-0 md:px-0">
        <div className="h-72 min-w-[520px] w-full md:h-[400px] md:min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={filteredChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
            <XAxis dataKey="month" stroke="#71717a" tick={{ fill: "#a1a1aa", fontSize: 11 }} tickFormatter={(v) => (v ? String(v).slice(2) : "")} interval={0} />
            <YAxis stroke="#71717a" tick={{ fill: "#a1a1aa", fontSize: 11 }} tickFormatter={(v) => safeNumber(v).toLocaleString()} />
            <YAxis yAxisId="search" orientation="right" stroke="#94a3b8" tick={{ fill: "#94a3b8", fontSize: 10 }} domain={naverDomainSingle} allowDataOverflow name="월간평균" />
            <Tooltip
              contentStyle={{ backgroundColor: "#18181b", border: "1px solid #3f3f46", borderRadius: "8px", minWidth: 240 }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length || !label) return null;
                const p = payload[0]?.payload as Record<string, string | number>;
                const outboundCats = data.categories.filter((c) => selectedCategories.has(c) && !String(c).startsWith("naver_"));
                const naverCats = Array.from(selectedCategories).filter((c) => NAVER_CATEGORIES.includes(c));
                return (
                  <div className="rounded-lg border border-zinc-600 bg-zinc-900 px-4 py-3">
                    <div className="mb-3 text-base font-bold text-cyan-400">{label}</div>
                    <div className="space-y-3">
                      <div>
                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">판매량</div>
                        {outboundCats.map((cat) => (
                          <div key={cat} className="flex justify-between gap-6 text-sm" style={{ color: getColorForCategory(cat, data.categories.indexOf(cat)) }}>
                            <span>{shortCategoryLabel(cat)}</span>
                            <span className="tabular-nums font-semibold text-white">{safeNumber(p?.[cat]).toLocaleString()} EA</span>
                          </div>
                        ))}
                      </div>
                      {showNaverSearch && naverCats.length > 0 && (
                        <div>
                          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">네이버 검색 지수</div>
                          {naverCats.map((cat) => {
                            const raw = p[`naver_${cat}`];
                            const num = typeof raw === "number" ? raw : parseFloat(String(raw ?? ""));
                            const display = !isNaN(num) ? Math.round(num) : "-";
                            return (
                              <div key={cat} className="flex justify-between gap-6 text-sm font-semibold" style={{ color: getColorForCategory(cat, data.categories.indexOf(cat)) }}>
                                <span>{cat}</span>
                                <span className="tabular-nums text-white">{display}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              }}
            />
            <Legend wrapperStyle={{ paddingTop: 8 }} formatter={(value) => <span className="text-sm text-zinc-300" title={value}>{String(value).startsWith("naver_") ? `네이버 ${String(value ?? "").replace("naver_", "")}` : value === "outboundTotal" ? "출고량" : shortCategoryLabel(value)}</span>} />
            <Bar dataKey="outboundTotal" fill="#52525b" fillOpacity={0.35} radius={[4, 4, 0, 0]} name="출고량" />
            {showTrendLine && <Line type="monotone" dataKey="trend" stroke="#f59e0b" strokeWidth={1} strokeDasharray="4 4" dot={false} name="추세선" connectNulls />}
            {showMovingAvg && <Line type="monotone" dataKey="ma3" stroke="#64748b" strokeWidth={1} strokeDasharray="4 4" dot={false} name="3개월 이동평균" connectNulls />}
            {showNaverSearch && NAVER_CATEGORIES.filter((c) => selectedCategories.has(c)).map((cat) => (
              <Line key={cat} type="monotone" dataKey={`naver_${cat}`} yAxisId="search" stroke={getColorForCategory(cat, data.categories.indexOf(cat))} strokeWidth={3} dot={{ r: 3 }} name={`naver_${cat}`} connectNulls />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
        </div>
        </div>
      )}

      {/* 네이버 검색 지수 변화율 액션플랜 (차트 하단) - 모바일: 한 줄에 하나씩 크게 */}
      {showNaverSearch && naverIndexActionPlans.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-3 lg:grid-cols-4">
          {naverIndexActionPlans.map((plan) => (
            <div
              key={plan.category}
              className={`rounded-xl border-2 px-5 py-4 sm:px-4 sm:py-3 ${
                plan.cardColor === "rose"
                  ? "border-rose-500/60 bg-rose-500/10"
                  : plan.cardColor === "emerald"
                    ? "border-emerald-500/60 bg-emerald-500/10"
                    : "border-zinc-600 bg-zinc-800/60"
              }`}
            >
              <div className="mb-2 flex items-center justify-between sm:mb-1.5">
                <span
                  className="text-base font-bold sm:text-sm"
                  style={{ color: getColorForCategory(plan.category, data.categories.indexOf(plan.category)) }}
                >
                  {plan.category}
                </span>
                <div className="flex flex-col items-end gap-0.5 text-right">
                  <span
                    className={`tabular-nums text-sm sm:text-xs ${
                      plan.changeRate < -10 ? "text-rose-400" : plan.changeRate >= 10 ? "text-emerald-400" : "text-zinc-400"
                    }`}
                  >
                    전월 {plan.changeRate > 0 ? "+" : ""}{plan.changeRate}%
                  </span>
                  <span
                    className={`tabular-nums text-xs sm:text-[10px] ${
                      plan.changeRateYoY < -10 ? "text-rose-300/80" : plan.changeRateYoY >= 10 ? "text-emerald-300/80" : "text-zinc-500"
                    }`}
                    title="작년 동월 대비"
                  >
                    YoY {plan.changeRateYoY > 0 ? "+" : ""}{plan.changeRateYoY}%
                  </span>
                </div>
              </div>
              <p className="text-base leading-relaxed text-zinc-200 sm:text-sm">{plan.message}</p>
            </div>
          ))}
        </div>
      )}

      {/* 결품으로 인한 판매 손실 */}
      {(() => {
        const catsWithSkus = Object.entries(shortageLostByCategory ?? {}).filter(
          ([_, v]) => v?.skus && v.skus.length > 0
        );
        if (catsWithSkus.length === 0) return null;
        return (
          <div className="min-w-0 overflow-x-auto">
            <h3 className="mb-3 text-sm font-semibold text-zinc-300">
              결품으로 인한 판매 손실
            </h3>
            <p className="mb-2 text-xs text-zinc-500">
              누적 출고량(최근 30일) 기반 일평균 × 3일. 품절임박(재고 3일 이하) 품목만 집계.
            </p>
            <table className="w-full min-w-[520px] border-collapse text-sm">
              <thead>
                <tr>
                  <th className="border border-zinc-600 bg-zinc-800/80 px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">
                    카테고리
                  </th>
                  <th className="border border-zinc-600 bg-zinc-800/80 px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">
                    품목(SKU)
                  </th>
                  <th className="border border-zinc-600 bg-zinc-800/80 px-3 py-2 text-right text-xs font-medium text-zinc-400">
                    추정 손실(EA)
                  </th>
                  <th className="border border-zinc-600 bg-zinc-800/80 px-3 py-2 text-right text-xs font-medium text-zinc-400">
                    3일 판매 가능(EA)
                  </th>
                  <th className="border border-zinc-600 bg-zinc-800/80 px-3 py-2 text-right text-xs font-medium text-zinc-400">
                    3일 판매량(EA)
                  </th>
                </tr>
              </thead>
              <tbody>
                {catsWithSkus.flatMap(([cat, data]) =>
                  (data.skus ?? []).map((s) => (
                    <tr key={`${cat}-${s.code}`} className="hover:bg-zinc-800/50">
                      <td className="border border-zinc-700 px-3 py-2 font-medium text-zinc-200" title={cat}>
                        {shortCategoryLabel(cat)}
                      </td>
                      <td className="border border-zinc-700 px-3 py-2 text-zinc-300" title={s.code}>
                        {simplifyProductName(s.label, s.pack_size) || s.code}
                      </td>
                      <td className="border border-zinc-700 px-3 py-2 text-right tabular-nums text-amber-400">
                        {safeNumber(Math.round(s.lost)).toLocaleString()}
                      </td>
                      <td className="border border-zinc-700 px-3 py-2 text-right tabular-nums text-zinc-400">
                        {safeNumber(Math.round(s.actual)).toLocaleString()}
                      </td>
                      <td className="border border-zinc-700 px-3 py-2 text-right tabular-nums text-zinc-400">
                        {safeNumber(Math.round(s.potential)).toLocaleString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        );
      })()}

      {/* 월별 카테고리 증감율 표 */}
      <div className="min-w-0 overflow-x-auto">
        <h3 className="mb-3 text-sm font-semibold text-zinc-300">
          월별 카테고리 증감율 (%)
        </h3>
        {filteredMomTable.length === 0 ? (
          <div className="rounded-xl border border-zinc-700 bg-zinc-800/30 py-8 text-center text-zinc-500">
            카테고리를 선택하면 월별 카테고리 증감율을 확인할 수 있습니다.
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
