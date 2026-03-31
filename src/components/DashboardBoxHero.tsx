"use client";

import { useMemo, useState, useEffect } from "react";
import { useInventory } from "@/context/InventoryContext";
import { simplifyProductName } from "@/lib/productNameFormatter";
import { SupabaseInventoryRefresh } from "./SupabaseInventoryRefresh";
import {
  computeTotalValue,
  computeAvgNDayOutboundByProduct,
  computeAvgNDayOutboundByProductByChannel,
  normalizeCategory,
  normalizeCode,
  STANDARD_CATEGORIES,
} from "@/lib/inventoryApi";
import type { InventoryProduct } from "@/lib/inventoryApi";
import { WAREHOUSE_COUPANG } from "@/lib/inventoryChannels";

type Channel = "all" | "coupang" | "general";

export type StockStatusType =
  | "warning"   // 데이터 오류
  | "out"      // 품절 임박
  | "low"      // 부족
  | "overstock" // 과재고
  | "normal";   // 정상

/** 기본 카테고리 순서: 전체(버튼) → 마스크 → 캡슐세제 → 섬유유연제 → 액상세제 */
const CATEGORY_ORDER = [...STANDARD_CATEGORIES];

/** 상태 우선순위 (낮을수록 먼저 표시) - 품절임박 최우선 */
const STATUS_PRIORITY: Record<StockStatusType, number> = {
  out: 0,      // 품절임박 - 최우선
  warning: 1,
  low: 2,
  overstock: 3,
  normal: 4,
};

/**
 * 재고 보유 일수(Days of Stock) 기준 상태 분류
 * 보유 일수 = 현재 재고 / 일일 평균 판매량 (최근 30일 출고/30)
 * - 품절 임박: 보유 일수 ≤ 3일
 * - 부족: 보유 일수 < 14일
 * - 과재고: 보유 일수 ≥ 60일
 * - 데이터 오류: 재고 ≤ 0
 * - 정상: 위에 해당하지 않는 경우
 */
function getStockStatus(
  stock: number,
  _safetyStock: number,
  hasNegativeWarning: boolean,
  dailyVelocity: number,
  hasRequiredData: boolean
): StockStatusType {
  if (!hasRequiredData || hasNegativeWarning || stock < 0) return "warning";
  if (stock <= 0) return "warning"; // 데이터 오류
  if (dailyVelocity <= 0) return "normal"; // 출고 이력 없으면 판단 불가 → 정상
  const daysOfStock = stock / dailyVelocity;
  if (daysOfStock <= 3) return "out";   // 품절 임박
  if (daysOfStock < 14) return "low";   // 부족
  if (daysOfStock >= 60) return "overstock";
  return "normal";
}

/** 채널별 재고 합산 (전체 = 쿠팡 + 일반). general 선택 시 데이터 없으면 전체 합산 반환 */
function getStockByChannel(
  stockByProductByChannel: { coupang: Record<string, number>; general: Record<string, number> } | undefined,
  channel: Channel
): Record<string, number> {
  if (!stockByProductByChannel) return {};
  const { coupang, general } = stockByProductByChannel;
  if (channel === "coupang") return coupang;
  if (channel === "general") {
    const generalSum = Object.values(general).reduce((a, b) => a + b, 0);
    if (generalSum === 0) {
      const merged: Record<string, number> = {};
      const codes = new Set([...Object.keys(coupang), ...Object.keys(general)]);
      Array.from(codes).forEach((code) => {
        merged[code] = (coupang[code] ?? 0) + (general[code] ?? 0);
      });
      return merged;
    }
    return general;
  }
  const merged: Record<string, number> = {};
  const codes = new Set([...Object.keys(coupang), ...Object.keys(general)]);
  Array.from(codes).forEach((code) => {
    merged[code] = (coupang[code] ?? 0) + (general[code] ?? 0);
  });
  return merged;
}

/** 마이너스 재고 방지: 0으로 표시하되 경고 여부 반환 */
function clampStock(stock: number): { display: number; hasWarning: boolean } {
  if (stock >= 0) return { display: stock, hasWarning: false };
  return { display: 0, hasWarning: true };
}

export function DashboardBoxHero() {
  const {
    useSupabaseInventory,
    inventoryProducts = [],
    inventoryOutbound = [],
    avg14DayOutboundByProduct: contextAvg14 = {},
    dailyVelocityByProduct: contextDailyVelocity = {},
    dailyVelocityByProductCoupang: contextDailyVelocityCoupang = {},
    dailyVelocityByProductGeneral: contextDailyVelocityGeneral = {},
    stockByProductByChannel,
    channelTotals: channelTotalsFromCtx,
    stockSnapshot = [],
    safetyStockByProduct = {},
    todayInOutCount = { inbound: 0, outbound: 0 },
    totalValue: contextTotalValue,
    lastMonthEndValue,
    valueVariance,
    recommendedOrderByProduct = {},
    categoryTrendData,
    aiForecastByProduct: contextAiForecast,
  } = useInventory() ?? {};

  const [channel, setChannel] = useState<Channel>("all");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [productFilter, setProductFilter] = useState<"active" | "discontinued" | "all">("active");
  const [selectedStatuses, setSelectedStatuses] = useState<Set<StockStatusType>>(
    () => new Set(["out"])
  );
  const [showDataErrors, setShowDataErrors] = useState(false);
  const [visibleCount, setVisibleCount] = useState(50);

  const momIndicators = categoryTrendData?.momIndicators ?? null;
  /** API `channelTotals`만 사용 (quick·snapshot 동일 집계) */
  const channelTotals = useMemo(
    () => channelTotalsFromCtx ?? {},
    [channelTotalsFromCtx]
  );
  const aiForecastByProduct = contextAiForecast ?? {};
  const safeNumber = (value: unknown): number => Number(value ?? 0) || 0;
  const renderData = {
    inventoryProducts,
    inventoryOutbound,
    channelTotals,
    categoryTrendData,
    stockByProductByChannel,
  };
  console.log("RENDER STEP", renderData);

  const stockByProductRaw = useMemo(
    () => getStockByChannel(stockByProductByChannel, channel),
    [stockByProductByChannel, channel]
  );

  const stockByProduct = useMemo(() => {
    const result: Record<string, number> = {};
    for (const [code, qty] of Object.entries(stockByProductRaw)) {
      result[code] = Math.max(0, qty);
    }
    return result;
  }, [stockByProductRaw]);

  const channelTotalValue = useMemo(() => {
    return computeTotalValue(stockByProduct, inventoryProducts);
  }, [stockByProduct, inventoryProducts]);

  const totalValue =
    stockSnapshot.length > 0 ? contextTotalValue : channelTotalValue;

  const { activeProducts, discontinuedProducts } = useMemo(() => {
    const active = inventoryProducts.filter((p) => p.is_active !== false);
    const discontinued = inventoryProducts.filter((p) => p.is_active === false);
    return { activeProducts: active, discontinuedProducts: discontinued };
  }, [inventoryProducts]);

  const baseProducts = useMemo(() => {
    if (productFilter === "active") return activeProducts;
    if (productFilter === "discontinued") return discontinuedProducts;
    return inventoryProducts;
  }, [productFilter, activeProducts, discontinuedProducts, inventoryProducts]);

  /** 카테고리 탭: 표준 카테고리만 표시 (제품명·긴 문자열 제외로 UI 깨짐 방지) */
  const categories = useMemo(() => {
    const isProductLike = (s: string) =>
      s.length > 12 || /개입|매입|매\b|케이스|CLA_|\[.*\]/.test(s) || /\d+개/.test(s);
    const fromData = baseProducts
      .map((p) => normalizeCategory(String(p.category ?? "").trim()) || String(p.category ?? "").trim())
      .filter((g) => g && g !== "기타" && g !== "전체" && !/^\d{10,}$/.test(g) && !isProductLike(g));
    const merged = new Set([...CATEGORY_ORDER, ...fromData]);
    const filtered = Array.from(merged).filter((c) => c !== "기타" && c !== "전체" && !isProductLike(c));
    return filtered.sort((a, b) => {
      const ia = (CATEGORY_ORDER as readonly string[]).indexOf(a);
      const ib = (CATEGORY_ORDER as readonly string[]).indexOf(b);
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1;
      if (ib >= 0) return 1;
      return a.localeCompare(b);
    });
  }, [baseProducts]);

  const avg14DayOutboundByProduct = useMemo(
    () => (contextAvg14 && Object.keys(contextAvg14).length > 0)
      ? contextAvg14
      : computeAvgNDayOutboundByProduct(inventoryOutbound, 14),
    [contextAvg14, inventoryOutbound]
  );

  const dailyVelocityByProductAll = useMemo(
    () => (contextDailyVelocity && Object.keys(contextDailyVelocity).length > 0)
      ? contextDailyVelocity
      : (() => {
          const avg30 = computeAvgNDayOutboundByProduct(inventoryOutbound, 30);
          const out: Record<string, number> = {};
          for (const [code, avg] of Object.entries(avg30)) out[code] = avg;
          return out;
        })(),
    [contextDailyVelocity, inventoryOutbound]
  );

  const dailyVelocityByProductCoupang = useMemo(
    () => (contextDailyVelocityCoupang && Object.keys(contextDailyVelocityCoupang).length > 0)
      ? contextDailyVelocityCoupang
      : (() => {
          const { coupang } = computeAvgNDayOutboundByProductByChannel(inventoryOutbound, 30);
          return coupang;
        })(),
    [contextDailyVelocityCoupang, inventoryOutbound]
  );

  const dailyVelocityByProductGeneral = useMemo(
    () => (contextDailyVelocityGeneral && Object.keys(contextDailyVelocityGeneral).length > 0)
      ? contextDailyVelocityGeneral
      : (() => {
          const { general } = computeAvgNDayOutboundByProductByChannel(inventoryOutbound, 30);
          return general;
        })(),
    [contextDailyVelocityGeneral, inventoryOutbound]
  );

  const dailyVelocityByProduct = useMemo(
    () => (channel === "coupang")
      ? dailyVelocityByProductCoupang
      : (channel === "general")
        ? dailyVelocityByProductGeneral
        : dailyVelocityByProductAll,
    [channel, dailyVelocityByProductAll, dailyVelocityByProductCoupang, dailyVelocityByProductGeneral]
  );

  const productsWithStatus = useMemo(() => {
    let list = baseProducts;
    if (selectedCategory) {
      const selNorm = selectedCategory.trim();
      list = list.filter((p) => {
        const raw = String(p.category ?? "").trim();
        const pCat = normalizeCategory(raw) || raw;
        return pCat === selNorm;
      });
    }
    return list.map((p) => {
      const rawStock = stockByProductRaw[p.product_code] ?? 0;
      const { display, hasWarning } = clampStock(rawStock);
      const safety = safetyStockByProduct[p.product_code] ?? 0;
      const dailyVelocity = dailyVelocityByProduct[p.product_code] ?? 0;
      const hasRequiredData = !!(p.product_code && p.product_name);
      const status = getStockStatus(
        display,
        safety,
        hasWarning,
        dailyVelocity,
        hasRequiredData
      );
      const daysOfStock = dailyVelocity > 0 ? display / dailyVelocity : null;
      return { product: p, stock: display, safetyStock: safety, hasWarning, status, daysOfStock };
    });
  }, [
    baseProducts,
    selectedCategory,
    stockByProductRaw,
    safetyStockByProduct,
    dailyVelocityByProduct,
  ]);

  const productsForDisplay = useMemo(() => {
    return showDataErrors ? productsWithStatus : productsWithStatus.filter((item) => item.status !== "warning");
  }, [productsWithStatus, showDataErrors]);

  const filteredProducts = useMemo(() => {
    let list = productsForDisplay;
    if (selectedStatuses.size === 0) {
      list = [];
    } else if (selectedStatuses.size < 5) {
      list = list.filter((item) => selectedStatuses.has(item.status));
    }
    return list.sort(
      (a, b) => STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status]
    );
  }, [productsForDisplay, selectedStatuses]);

  const displayedProducts = useMemo(
    () => filteredProducts.slice(0, visibleCount),
    [filteredProducts, visibleCount]
  );
  const hasMore = visibleCount < filteredProducts.length;

  useEffect(() => {
    setVisibleCount(50);
  }, [selectedCategory, productFilter, selectedStatuses, showDataErrors]);

  const statusCounts = useMemo(() => {
    const counts: Record<StockStatusType, number> = {
      warning: 0,
      out: 0,
      low: 0,
      overstock: 0,
      normal: 0,
    };
    for (const item of productsWithStatus) {
      counts[item.status]++;
    }
    return counts;
  }, [productsWithStatus]);

  const warningCount = statusCounts.warning;
  const nearOutCount = statusCounts.out;
  const lowCount = statusCounts.low;
  const overstockCount = statusCounts.overstock;
  const normalCount = statusCounts.normal;

  const negativeStockCount = useMemo(() => {
    return Object.values(stockByProductRaw).filter((q) => q < 0).length;
  }, [stockByProductRaw]);

  /** 키는 정규화된 "쿠팡" | "일반" (resolveSnapshotChannelWithSource) */
  const { coupangStockTotal, generalStockTotal } = useMemo(() => {
    let coupang = 0;
    let general = 0;
    for (const [wh, qty] of Object.entries(channelTotals)) {
      if (wh === WAREHOUSE_COUPANG) coupang += qty;
      else general += qty;
    }
    return { coupangStockTotal: coupang, generalStockTotal: general };
  }, [channelTotals]);

  const channelTheme = {
    all: {
      border: "border-slate-200",
      bg: "bg-white",
      accent: "indigo",
      totalBorder: "border-indigo-200",
      totalBg: "from-indigo-50",
      totalText: "text-indigo-600",
      tabActive: "bg-indigo-500 text-white",
    },
    coupang: {
      border: "border-orange-200",
      bg: "bg-white",
      accent: "orange",
      totalBorder: "border-orange-200",
      totalBg: "from-orange-50",
      totalText: "text-orange-600",
      tabActive: "bg-orange-500 text-white",
    },
    general: {
      border: "border-sky-200",
      bg: "bg-white",
      accent: "sky",
      totalBorder: "border-sky-200",
      totalBg: "from-sky-50",
      totalText: "text-sky-600",
      tabActive: "bg-sky-500 text-white",
    },
  };
  const theme = channelTheme[channel];

  return (
    <div
      className={`mt-8 min-h-[12rem] min-w-0 space-y-6 overflow-hidden rounded-2xl border ${theme.border} ${theme.bg} p-4 shadow-card transition-colors md:mt-10 md:p-6`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-bold text-slate-800 md:text-xl">
          재고 대시보드
        </h1>
        <SupabaseInventoryRefresh />
      </div>
      {!useSupabaseInventory && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          데이터 없음 (로컬 모드). 값은 0 기준으로 표시됩니다.
        </div>
      )}

      {/* 채널 탭: 전체 | 쿠팡 보유 재고 | 일반 보유 재고 */}
      <div className="space-y-2">
        <div className="flex gap-2 rounded-xl border border-slate-200 bg-slate-50 p-1">
          <button
            type="button"
            onClick={() => setChannel("all")}
            className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${
              channel === "all"
                ? "bg-indigo-500 text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-200"
            }`}
          >
            전체
          </button>
          <button
            type="button"
            onClick={() => setChannel("coupang")}
            className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${
              channel === "coupang"
                ? "bg-orange-500 text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-200"
            }`}
          >
            쿠팡 보유 재고
          </button>
          <button
            type="button"
            onClick={() => setChannel("general")}
            className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${
              channel === "general"
                ? "bg-sky-500 text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-200"
            }`}
          >
            일반 보유 재고
          </button>
        </div>
        <div className="flex flex-wrap gap-4 text-sm text-slate-600">
          <span>쿠팡: <span className="font-semibold text-orange-600">{safeNumber(coupangStockTotal).toLocaleString()}EA</span></span>
          <span>일반: <span className="font-semibold text-sky-600">{safeNumber(generalStockTotal).toLocaleString()}EA</span></span>
        </div>
        {Object.keys(channelTotals).length > 0 ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 min-w-0">
            <div className="text-xs font-medium uppercase tracking-wider text-slate-500">채널별 재고</div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
              {Object.entries(channelTotals ?? {})
                .sort(([, a], [, b]) => b - a)
                .map(([ch, qty]) => (
                  <div key={ch} className="flex shrink-0 items-baseline gap-1.5 whitespace-nowrap">
                    <span className="text-sm text-slate-600">{ch}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${ch === WAREHOUSE_COUPANG ? "bg-orange-100 text-orange-700" : "bg-sky-100 text-sky-700"}`}>
                      {ch === WAREHOUSE_COUPANG ? "(쿠팡)" : "(일반)"}
                    </span>
                    <span className="font-bold tabular-nums text-slate-800">{safeNumber(qty).toLocaleString()}EA</span>
                  </div>
                ))}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 min-w-0 text-sm text-slate-500">
            채널별 재고 데이터 없음 (0)
          </div>
        )}
      </div>

      {/* 마이너스 재고 경고 */}
      {negativeStockCount > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 shadow-sm">
          <span className="text-lg" role="img" aria-label="경고">
            ⚠️
          </span>
          <span className="text-sm text-amber-800">
            {channel === "all" ? "전체" : channel === "coupang" ? "쿠팡" : "일반"} 채널에서 입고 없이 출고만 있는 제품이 {negativeStockCount}건 있습니다. 재고는 0으로 표시됩니다.
          </span>
        </div>
      )}

      {/* 품목 필터: 체크박스 형태 (전체 선택 / 전체 해제) */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-medium uppercase tracking-wider text-slate-500">
          상태 필터
        </span>
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
          <button
            type="button"
            onClick={() => setSelectedStatuses(new Set(["warning", "out", "low", "overstock", "normal"]))}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              selectedStatuses.size === 5
                ? "bg-indigo-500/30 text-indigo-700 ring-1 ring-indigo-500/50"
                : "text-slate-600 hover:bg-slate-200"
            }`}
          >
            전체 선택
          </button>
          <button
            type="button"
            onClick={() => setSelectedStatuses(new Set())}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              selectedStatuses.size === 0
                ? "bg-slate-600 text-slate-100 ring-1 ring-slate-500/50"
                : "text-slate-600 hover:bg-slate-200"
            }`}
          >
            전체 해제
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {(["out", "low", "overstock", "normal", "warning"] as const).map((status) => {
            const config = {
              out: { label: "품절임박", count: nearOutCount, color: "#f43f5e" },
              low: { label: "부족", count: lowCount, color: "#f59e0b" },
              overstock: { label: "과재고", count: overstockCount, color: "#8b5cf6" },
              normal: { label: "정상", count: normalCount, color: "#10b981" },
              warning: { label: "데이터 오류", count: warningCount, color: "#ef4444" },
            }[status];
            return (
              <label
                key={status}
                className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm transition-colors hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={selectedStatuses.has(status)}
                  onChange={() => {
                    setSelectedStatuses((prev) => {
                      const next = new Set(prev);
                      if (next.has(status)) next.delete(status);
                      else next.add(status);
                      return next;
                    });
                  }}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-500 focus:ring-indigo-500"
                />
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: config.color }}
                />
                <span className="text-sm font-medium text-slate-700">
                  {config.label} ({config.count}건)
                </span>
              </label>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => setShowDataErrors((prev) => !prev)}
          className={`rounded-xl px-3 py-2 text-xs font-medium transition-colors ${
            showDataErrors
              ? "bg-red-100 text-red-700 ring-1 ring-red-300"
              : "border border-slate-200 text-slate-600 hover:bg-slate-50"
          }`}
          title={showDataErrors ? "클릭 시 데이터 오류 숨김" : "클릭 시 데이터 오류 표시"}
        >
          데이터 오류 {showDataErrors ? "표시 중" : "숨김"}
        </button>
      </div>

      {/* 상단 요약 카드: 한눈에 보는 재고 현황 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
          <div className="text-xs font-medium uppercase tracking-wider text-slate-500">전체</div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-slate-800 md:text-3xl">
            {safeNumber(productsForDisplay?.length).toLocaleString()}건
          </div>
        </div>
        <div className="rounded-2xl border-2 border-rose-300 bg-rose-50 p-5 shadow-card">
          <div className="text-xs font-medium uppercase tracking-wider text-rose-600">품절임박</div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-rose-700 md:text-3xl">
            {safeNumber(nearOutCount).toLocaleString()}건
          </div>
          <div className="mt-1 text-[10px] text-rose-600/90">3일 이내 재고 소진</div>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-card">
          <div className="text-xs font-medium uppercase tracking-wider text-amber-600">부족</div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-amber-700 md:text-3xl">
            {safeNumber(lowCount).toLocaleString()}건
          </div>
          <div className="mt-1 text-[10px] text-amber-600/90">14일 미만 보유</div>
        </div>
        <div className="rounded-2xl border border-violet-200 bg-violet-50 p-5 shadow-card">
          <div className="text-xs font-medium uppercase tracking-wider text-violet-600">과재고</div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-violet-700 md:text-3xl">
            {safeNumber(overstockCount).toLocaleString()}건
          </div>
          <div className="mt-1 text-[10px] text-violet-600/90">60일 이상 보유</div>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-card">
          <div className="text-xs font-medium uppercase tracking-wider text-emerald-600">정상</div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-emerald-700 md:text-3xl">
            {safeNumber(normalCount).toLocaleString()}건
          </div>
          <div className="mt-1 text-[10px] text-emerald-600/90">14~60일 보유</div>
        </div>
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 shadow-card">
          <div className="text-xs font-medium uppercase tracking-wider text-red-600">데이터 오류</div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-red-700 md:text-3xl">
            {safeNumber(warningCount).toLocaleString()}건
          </div>
          <div className="mt-1 text-[10px] text-red-600/90">재고·정보 확인 필요</div>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-card">
          <div className="text-xs font-medium uppercase tracking-wider text-emerald-600">
            오늘 입고/출고
          </div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-emerald-700 md:text-3xl">
            {safeNumber(todayInOutCount?.inbound).toLocaleString()} / {safeNumber(todayInOutCount?.outbound).toLocaleString()}건
          </div>
        </div>
        {momIndicators ? (
          <>
            <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5 shadow-card">
              <div className="text-xs font-medium uppercase tracking-wider text-indigo-600">
                이번 달 총 판매량
                {momIndicators.kpiMonthKey ? (
                  <span className="ml-1.5 font-normal normal-case text-slate-500">({momIndicators.kpiMonthKey})</span>
                ) : null}
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold tabular-nums text-indigo-700 md:text-3xl">
                  {safeNumber(momIndicators?.thisMonthOutbound).toLocaleString()}건
                </span>
                {momIndicators.outbound != null && (
                  <span className={`text-sm font-medium ${momIndicators.outbound >= 0 ? "text-red-600" : "text-blue-600"}`}>
                    {momIndicators.outbound >= 0 ? "▲" : "▼"} {Math.abs(momIndicators.outbound)}%
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-slate-600">
                <span>쿠팡: {safeNumber(momIndicators?.thisMonthOutboundCoupang).toLocaleString()}EA</span>
                <span>일반: {safeNumber(momIndicators?.thisMonthOutboundGeneral).toLocaleString()}EA</span>
              </div>
              <div className="mt-0.5 text-[10px] text-slate-500">전월 대비</div>
            </div>
            <div className="rounded-2xl border border-sky-200 bg-sky-50 p-5 shadow-card">
              <div className="text-xs font-medium uppercase tracking-wider text-sky-600">
                이번 달 총 입고량
                {momIndicators.kpiMonthKey ? (
                  <span className="ml-1.5 font-normal normal-case text-slate-500">({momIndicators.kpiMonthKey})</span>
                ) : null}
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold tabular-nums text-sky-700 md:text-3xl">
                  {safeNumber(momIndicators?.thisMonthInbound).toLocaleString()}EA
                </span>
                {momIndicators.inbound != null && (
                  <span className={`text-sm font-medium ${momIndicators.inbound >= 0 ? "text-red-600" : "text-blue-600"}`}>
                    {momIndicators.inbound >= 0 ? "▲" : "▼"} {Math.abs(momIndicators.inbound)}%
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-slate-600">
                {Object.entries(
                  momIndicators.thisMonthInboundByChannel ??
                    momIndicators.thisMonthInboundByWarehouse ??
                    {}
                ).length > 0
                  ? Object.entries(
                      momIndicators.thisMonthInboundByChannel ??
                        momIndicators.thisMonthInboundByWarehouse ??
                        {}
                    )
                      .sort(([, a], [, b]) => b - a)
                      .map(([ch, qty]) => (
                        <span key={ch}>{ch}: {safeNumber(qty).toLocaleString()}EA</span>
                      ))
                  : <span>채널별 데이터 없음</span>}
              </div>
              <div className="mt-0.5 text-[10px] text-slate-500">입고처 → 판매채널(쿠팡/일반) 기준 · 전월 대비</div>
            </div>
          </>
        ) : (
          <div className="col-span-2 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-500 shadow-card">
            월간 입출고 지표 데이터 없음
          </div>
        )}
      </div>

      {/* 총 재고 금액 (채널별 실시간 재계산) */}
      <div className={`rounded-2xl border ${theme.totalBorder} bg-white p-5 shadow-card`}>
        <div className={`text-xs font-medium uppercase tracking-wider ${theme.totalText}`}>
          재고 금액
          {channel !== "all" && (
            <span className="ml-2 text-slate-500">
              — {channel === "coupang" ? "쿠팡" : "일반"} 채널
            </span>
          )}
        </div>
        <div className="mt-1 text-2xl font-bold tabular-nums text-slate-800 md:text-3xl">
          {safeNumber(totalValue).toLocaleString()}원
        </div>
        {channel === "all" && valueVariance != null && lastMonthEndValue != null && lastMonthEndValue > 0 && (
          <div className="mt-1 text-xs text-slate-500">
            전월 말 대비 {valueVariance >= 0 ? "+" : ""}{safeNumber(valueVariance).toLocaleString()}원
            {valueVariance !== 0 && (
              <span className={`ml-1 ${valueVariance > 0 ? "text-emerald-600" : "text-red-600"}`}>
                ({valueVariance > 0 ? "▲" : "▼"} {Math.abs(Math.round((valueVariance / lastMonthEndValue) * 100))}%)
              </span>
            )}
          </div>
        )}
      </div>

      {/* 카테고리 탭 */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setSelectedCategory(null)}
          className={`shrink-0 rounded-xl px-4 py-2 text-sm font-medium transition-colors shadow-sm ${
            selectedCategory === null
              ? channel === "coupang"
                ? "bg-orange-500 text-white"
                : channel === "general"
                  ? "bg-sky-500 text-white"
                  : "bg-indigo-500 text-white"
              : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
          }`}
        >
          전체
        </button>
        {categories.map((cat) => (
          <button
            key={String(cat)}
            type="button"
            onClick={() => setSelectedCategory(cat)}
            className={`shrink-0 max-w-[180px] truncate rounded-xl px-4 py-2 text-sm font-medium transition-colors shadow-sm ${
              selectedCategory === cat
                ? channel === "coupang"
                  ? "bg-orange-500 text-white"
                  : channel === "general"
                    ? "bg-sky-500 text-white"
                    : "bg-indigo-500 text-white"
                : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
            title={cat}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* 제품 카드 그리드 (50건씩 무한 스크롤) */}
      <div className="grid min-w-0 grid-cols-1 gap-4 overflow-hidden sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {displayedProducts.map((item) => {
          const fc = aiForecastByProduct[item.product.product_code]
            ?? aiForecastByProduct[normalizeCode(item.product.product_code) ?? ""];
          const f1 = fc?.forecast_month1 ?? 0;
          const stock = item.stock;
          const dailyVelocity = dailyVelocityByProduct[item.product.product_code] ?? 0;
          // 부족 수량: 원래대로 (AI 있으면 f1-재고, 없으면 안전재고-현재재고)
          const aiShortfall = f1 > 0 && stock < f1 ? Math.max(0, Math.ceil(f1 - stock)) : undefined;
          // 권장 입고 수량: 1주일 판매 부족 수량 (일평균×7 - 재고)
          const oneWeekShortage =
            dailyVelocity > 0 && stock < dailyVelocity * 7
              ? Math.max(0, Math.ceil(dailyVelocity * 7 - stock))
              : undefined;
          return (
            <ProductCard
              key={item.product.id}
              product={item.product}
              stock={stock}
              safetyStock={item.safetyStock}
              hasNegativeWarning={item.hasWarning}
              status={item.status}
              daysOfStock={item.daysOfStock}
              aiShortfall={aiShortfall}
              recommendedOrder={oneWeekShortage ?? recommendedOrderByProduct[item.product.product_code]}
            />
          );
        })}
      </div>

      {hasMore && (
        <div className="flex justify-center py-6">
          <button
            type="button"
            onClick={() => setVisibleCount((v) => Math.min(v + 50, filteredProducts.length))}
            className="rounded-xl border border-slate-200 bg-white px-6 py-3 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
          >
            더 보기 ({filteredProducts.length - visibleCount}건 남음)
          </button>
        </div>
      )}

      {filteredProducts.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white py-16 text-center text-slate-500 shadow-card">
          {selectedStatuses.size === 0
            ? "상태 필터를 선택해 주세요. (전체 선택 시 전체 보기)"
            : selectedStatuses.size < 5
              ? `선택한 상태의 제품이 없습니다. (전체 선택으로 전체 보기)${selectedStatuses.has("warning") ? " — 마이너스 재고·필수정보 누락 시 데이터 오류로 분류됩니다." : ""}`
              : "해당 카테고리에 제품이 없습니다."}
        </div>
      )}
    </div>
  );
}

const STATUS_CONFIG: Record<
  StockStatusType,
  { label: string; className: string }
> = {
  warning: {
    label: "데이터 오류",
    className: "bg-red-100 text-red-700 border-red-200",
  },
  out: {
    label: "품절 임박",
    className: "bg-rose-100 text-rose-700 border-rose-200",
  },
  low: {
    label: "부족",
    className: "bg-amber-100 text-amber-700 border-amber-200",
  },
  overstock: {
    label: "과재고",
    className: "bg-violet-100 text-violet-700 border-violet-200",
  },
  normal: {
    label: "정상",
    className: "bg-emerald-100 text-emerald-700 border-emerald-200",
  },
};

function ProductCard({
  product,
  stock,
  safetyStock,
  hasNegativeWarning,
  status,
  daysOfStock,
  recommendedOrder,
  aiShortfall,
}: {
  product: InventoryProduct;
  stock: number;
  safetyStock: number;
  hasNegativeWarning?: boolean;
  status: StockStatusType;
  daysOfStock?: number | null;
  recommendedOrder?: number;
  aiShortfall?: number;
}) {
  const safeNumber = (value: unknown): number => Number(value ?? 0) || 0;
  const cfg = STATUS_CONFIG[status];
  const displayStock = Number.isFinite(stock) ? Math.floor(stock) : 0;
  const shortfall = safetyStock > 0 && displayStock < safetyStock
    ? Math.max(0, safetyStock - displayStock)
    : 0;
  const simplifiedName = simplifyProductName(String(product.product_name ?? product.product_code ?? ""), product.pack_size);
  const packSize = product.pack_size ?? 0;
  const boxCount = packSize > 0 ? Math.floor(displayStock / packSize) : null;
  const needsAction = status === "out" || status === "low";
  const recommendedBox = recommendedOrder != null && recommendedOrder > 0 && packSize > 0
    ? Math.ceil(recommendedOrder / packSize)
    : null;

  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-card transition-shadow hover:shadow-card-hover h-full">
      {/* 상단: 제품명 + 상태 */}
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0 flex-1 overflow-hidden">
          <div
            className="line-clamp-2 text-[13px] font-semibold leading-snug text-slate-800 md:text-sm"
            title={String(product.product_name ?? product.product_code ?? "").trim() || "-"}
          >
            {simplifiedName || String(product.product_name ?? product.product_code ?? "").trim() || "-"}
          </div>
          <div className="mt-0.5 truncate text-xs text-slate-500" title={product.product_code}>
            {String(product.category ?? "").trim() || "기타"}
            {product.product_code && ` · ${String(product.product_code).trim()}`}
          </div>
        </div>
        <span
          className={`shrink-0 rounded-lg border px-2 py-0.5 text-[10px] font-bold ${cfg.className}`}
        >
          {cfg.label}
        </span>
      </div>

      {/* 핵심 지표: 한눈에 보기 */}
      <div className="mt-4 space-y-2">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
          <span className="text-slate-500">재고</span>
          <span className="font-semibold tabular-nums text-slate-800">{safeNumber(displayStock).toLocaleString()}개</span>
          {boxCount != null && (
            <>
              <span className="text-slate-400">·</span>
              <span className="text-slate-500">박스</span>
              <span className="font-medium tabular-nums text-slate-700">{safeNumber(boxCount).toLocaleString()}박스</span>
            </>
          )}
          {daysOfStock != null && daysOfStock > 0 && (
            <>
              <span className="text-slate-400">·</span>
              <span className={needsAction ? "font-semibold text-rose-600" : "text-slate-600"}>
                {daysOfStock.toFixed(1)}일 남음
              </span>
            </>
          )}
        </div>

        {/* 부족 수량(원래대로) · 권장 입고 수량(1주일 판매 부족) */}
        {((shortfall > 0 || (aiShortfall != null && aiShortfall > 0)) || (recommendedOrder != null && recommendedOrder > 0)) && (
          <div className="flex flex-wrap gap-x-4 gap-y-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            {(shortfall > 0 || (aiShortfall != null && aiShortfall > 0)) && (
              <div className="flex items-baseline gap-1.5">
                <span className="text-xs text-slate-500">
                  부족 수량
                  {aiShortfall != null && aiShortfall > 0 && (
                    <span className="ml-1 rounded bg-cyan-100 px-1 py-0.5 text-[10px] font-medium text-cyan-700">AI</span>
                  )}
                </span>
                <span className="font-semibold tabular-nums text-red-600">
                  {safeNumber(Math.ceil((aiShortfall != null && aiShortfall > 0 ? aiShortfall : shortfall) / (packSize || 1))).toLocaleString()}박스
                </span>
              </div>
            )}
            {(recommendedOrder != null && recommendedOrder > 0) && (
              <div className="flex items-baseline gap-1.5">
                <span className={`text-xs font-medium ${needsAction ? "text-rose-600" : "text-indigo-600"}`}>
                  권장 입고 수량
                </span>
                <span className={`font-bold tabular-nums ${needsAction ? "text-rose-700" : "text-indigo-700"}`}>
                  {safeNumber(Math.ceil((recommendedOrder ?? 0) / (packSize || 1))).toLocaleString()}박스
                </span>
              </div>
            )}
          </div>
        )}

        {hasNegativeWarning && (
          <div className="flex items-center gap-1.5 text-amber-600 text-xs">
            <span role="img" aria-label="경고">⚠️</span>
            <span>입고 없이 출고만 있는 제품</span>
          </div>
        )}
      </div>
    </div>
  );
}
