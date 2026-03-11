"use client";

import { useMemo, useState, useEffect } from "react";
import { useInventory } from "@/context/InventoryContext";
import { simplifyProductName } from "@/lib/productNameFormatter";
import { SupabaseInventoryRefresh } from "./SupabaseInventoryRefresh";
import {
  computeTotalValue,
  computeAvgNDayOutboundByProduct,
} from "@/lib/inventoryApi";
import type { InventoryProduct } from "@/lib/inventoryApi";

type Channel = "all" | "coupang" | "general";

export type StockStatusType =
  | "warning"   // 데이터 오류
  | "out"      // 품절 임박
  | "low"      // 부족
  | "overstock" // 과재고
  | "normal";   // 정상

/** 기본 카테고리 (필터에 항상 노출, DB group_name과 병합) */
const STANDARD_CATEGORIES = ["마스크", "캡슐세제", "섬유유연제", "액상세제", "생활용품"];

/** 상태 우선순위 (낮을수록 먼저 표시) */
const STATUS_PRIORITY: Record<StockStatusType, number> = {
  warning: 0,
  out: 1,
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
    stockByProductByChannel,
    stockSnapshot = [],
    safetyStockByProduct = {},
    todayInOutCount = { inbound: 0, outbound: 0 },
    totalValue: contextTotalValue,
    lastMonthEndValue,
    valueVariance,
    recommendedOrderByProduct = {},
  } = useInventory();

  const [channel, setChannel] = useState<Channel>("all");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [productFilter, setProductFilter] = useState<"active" | "discontinued" | "all">("active");
  const [showNormal, setShowNormal] = useState(true);
  const [visibleCount, setVisibleCount] = useState(50);
  const [momIndicators, setMomIndicators] = useState<{
    outbound: number | null;
    inbound: number | null;
    thisMonthOutbound: number;
    thisMonthInbound: number;
    thisMonthOutboundCoupang?: number;
    thisMonthOutboundGeneral?: number;
    thisMonthInboundCoupang?: number;
    thisMonthInboundGeneral?: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/category-trend")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d.momIndicators) setMomIndicators(d.momIndicators);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

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

  const categories = useMemo(() => {
    const fromData = baseProducts.map((p) => p.group_name).filter((g) => g && g !== "기타");
    const merged = new Set([...STANDARD_CATEGORIES, ...fromData]);
    return Array.from(merged).filter((c) => c !== "기타").sort();
  }, [baseProducts]);

  const avg14DayOutboundByProduct = useMemo(
    () => (contextAvg14 && Object.keys(contextAvg14).length > 0)
      ? contextAvg14
      : computeAvgNDayOutboundByProduct(inventoryOutbound, 14),
    [contextAvg14, inventoryOutbound]
  );

  const dailyVelocityByProduct = useMemo(
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

  const productsWithStatus = useMemo(() => {
    let list = baseProducts;
    if (selectedCategory) {
      list = list.filter((p) => p.group_name === selectedCategory);
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

  const filteredProducts = useMemo(() => {
    let list = productsWithStatus;
    if (!showNormal) {
      list = list.filter((item) => item.status !== "normal");
    }
    return list.sort(
      (a, b) => STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status]
    );
  }, [productsWithStatus, showNormal]);

  const displayedProducts = useMemo(
    () => filteredProducts.slice(0, visibleCount),
    [filteredProducts, visibleCount]
  );
  const hasMore = visibleCount < filteredProducts.length;

  useEffect(() => {
    setVisibleCount(50);
  }, [selectedCategory, productFilter, showNormal]);

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

  const nearOutCount = statusCounts.out;
  const lowCount = statusCounts.low;
  const overstockCount = statusCounts.overstock;
  const warningCount = statusCounts.warning;

  const negativeStockCount = useMemo(() => {
    return Object.values(stockByProductRaw).filter((q) => q < 0).length;
  }, [stockByProductRaw]);

  const coupangStockTotal = useMemo(() => {
    if (!stockByProductByChannel?.coupang) return 0;
    return Object.values(stockByProductByChannel.coupang).reduce((a, b) => a + b, 0);
  }, [stockByProductByChannel]);

  const generalStockTotal = useMemo(() => {
    if (!stockByProductByChannel?.general) return 0;
    return Object.values(stockByProductByChannel.general).reduce((a, b) => a + b, 0);
  }, [stockByProductByChannel]);

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

  if (!useSupabaseInventory || inventoryProducts.length === 0) {
    return null;
  }

  return (
    <div className={`min-w-0 space-y-6 overflow-hidden rounded-2xl border ${theme.border} ${theme.bg} p-4 shadow-card transition-colors md:p-6`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-bold text-slate-800 md:text-xl">
          재고 대시보드
        </h1>
        <SupabaseInventoryRefresh />
      </div>

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
          <span>쿠팡: <span className="font-semibold text-orange-600">{coupangStockTotal.toLocaleString()}EA</span></span>
          <span>일반: <span className="font-semibold text-sky-600">{generalStockTotal.toLocaleString()}EA</span></span>
        </div>
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

      {/* 품목 필터: 현재 운영 | 단종 | 전체 | 정상 표시 */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setProductFilter("active")}
          className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors shadow-sm ${
            productFilter === "active"
              ? "bg-emerald-500 text-white"
              : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
          }`}
        >
          현재 운영 ({activeProducts.length}건)
        </button>
        <button
          type="button"
          onClick={() => setProductFilter("discontinued")}
          className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors shadow-sm ${
            productFilter === "discontinued"
              ? "bg-amber-500 text-white"
              : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
          }`}
        >
          단종 품목 ({discontinuedProducts.length}건)
        </button>
        <button
          type="button"
          onClick={() => setProductFilter("all")}
          className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors shadow-sm ${
            productFilter === "all"
              ? "bg-indigo-500 text-white"
              : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
          }`}
        >
          전체 ({inventoryProducts.length}건)
        </button>
        <button
          type="button"
          onClick={() => setShowNormal((v) => !v)}
          className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors shadow-sm ${
            showNormal
              ? "bg-slate-600 text-white"
              : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
          }`}
        >
          {showNormal ? "정상 숨기기" : "정상 표시"}
        </button>
      </div>

      {/* 상단 요약 카드 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
          <div className="text-xs font-medium uppercase tracking-wider text-slate-500">
            전체 품목
          </div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-slate-800 md:text-3xl">
            {activeProducts.length.toLocaleString()}건
          </div>
        </div>
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 shadow-card">
          <div className="text-xs font-medium uppercase tracking-wider text-red-600">
            데이터 오류
          </div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-red-700 md:text-3xl">
            {warningCount.toLocaleString()}건
          </div>
          <div className="mt-1 text-[10px] text-slate-500">재고 ≤ 0</div>
        </div>
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 shadow-card">
          <div className="text-xs font-medium uppercase tracking-wider text-rose-600">
            품절 임박
          </div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-rose-700 md:text-3xl">
            {nearOutCount.toLocaleString()}건
          </div>
          <div className="mt-1 text-[10px] text-slate-500">보유 일수 ≤ 3일</div>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-card">
          <div className="text-xs font-medium uppercase tracking-wider text-amber-600">
            부족
          </div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-amber-700 md:text-3xl">
            {lowCount.toLocaleString()}건
          </div>
          <div className="mt-1 text-[10px] text-slate-500">보유 일수 &lt; 14일</div>
        </div>
        <div className="rounded-2xl border border-violet-200 bg-violet-50 p-5 shadow-card">
          <div className="text-xs font-medium uppercase tracking-wider text-violet-600">
            과재고
          </div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-violet-700 md:text-3xl">
            {overstockCount.toLocaleString()}건
          </div>
          <div className="mt-1 text-[10px] text-zinc-500">보유 일수 ≥ 60일</div>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-card">
          <div className="text-xs font-medium uppercase tracking-wider text-emerald-600">
            오늘 입고/출고
          </div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-emerald-700 md:text-3xl">
            {todayInOutCount.inbound} / {todayInOutCount.outbound}건
          </div>
        </div>
        {momIndicators && (
          <>
            <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5 shadow-card">
              <div className="text-xs font-medium uppercase tracking-wider text-indigo-600">
                이번 달 총 판매량
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold tabular-nums text-indigo-700 md:text-3xl">
                  {momIndicators.thisMonthOutbound.toLocaleString()}건
                </span>
                {momIndicators.outbound != null && (
                  <span className={`text-sm font-medium ${momIndicators.outbound >= 0 ? "text-red-600" : "text-blue-600"}`}>
                    {momIndicators.outbound >= 0 ? "▲" : "▼"} {Math.abs(momIndicators.outbound)}%
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-slate-600">
                <span>쿠팡: {(momIndicators.thisMonthOutboundCoupang ?? 0).toLocaleString()}EA</span>
                <span>일반: {(momIndicators.thisMonthOutboundGeneral ?? 0).toLocaleString()}EA</span>
              </div>
              <div className="mt-0.5 text-[10px] text-slate-500">전월 대비</div>
            </div>
            <div className="rounded-2xl border border-sky-200 bg-sky-50 p-5 shadow-card">
              <div className="text-xs font-medium uppercase tracking-wider text-sky-600">
                이번 달 총 입고량
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold tabular-nums text-sky-700 md:text-3xl">
                  {momIndicators.thisMonthInbound.toLocaleString()}EA
                </span>
                {momIndicators.inbound != null && (
                  <span className={`text-sm font-medium ${momIndicators.inbound >= 0 ? "text-red-600" : "text-blue-600"}`}>
                    {momIndicators.inbound >= 0 ? "▲" : "▼"} {Math.abs(momIndicators.inbound)}%
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-slate-600">
                <span>쿠팡: {(momIndicators.thisMonthInboundCoupang ?? 0).toLocaleString()}EA</span>
                <span>일반: {(momIndicators.thisMonthInboundGeneral ?? 0).toLocaleString()}EA</span>
              </div>
              <div className="mt-0.5 text-[10px] text-slate-500">전월 대비</div>
            </div>
          </>
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
          {totalValue.toLocaleString()}원
        </div>
        {channel === "all" && valueVariance != null && lastMonthEndValue != null && lastMonthEndValue > 0 && (
          <div className="mt-1 text-xs text-slate-500">
            전월 말 대비 {valueVariance >= 0 ? "+" : ""}{valueVariance.toLocaleString()}원
            {valueVariance !== 0 && (
              <span className={`ml-1 ${valueVariance > 0 ? "text-emerald-600" : "text-red-600"}`}>
                ({valueVariance > 0 ? "▲" : "▼"} {Math.abs(Math.round((valueVariance / lastMonthEndValue) * 100))}%)
              </span>
            )}
          </div>
        )}
      </div>

      {/* 카테고리 탭 */}
      <div className="flex flex-wrap gap-2">
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
            className={`shrink-0 rounded-xl px-4 py-2 text-sm font-medium transition-colors shadow-sm ${
              selectedCategory === cat
                ? channel === "coupang"
                  ? "bg-orange-500 text-white"
                  : channel === "general"
                    ? "bg-sky-500 text-white"
                    : "bg-indigo-500 text-white"
                : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* 제품 카드 그리드 (50건씩 무한 스크롤) */}
      <div className="grid min-w-0 grid-cols-1 gap-4 overflow-hidden sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {displayedProducts.map((item) => (
          <ProductCard
            key={item.product.id}
            product={item.product}
            stock={item.stock}
            safetyStock={item.safetyStock}
            hasNegativeWarning={item.hasWarning}
            status={item.status}
            daysOfStock={item.daysOfStock}
            recommendedOrder={recommendedOrderByProduct[item.product.product_code]}
          />
        ))}
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
          {!showNormal
            ? "문제가 있는 제품이 없습니다. (정상 표시 버튼으로 전체 보기)"
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
}: {
  product: InventoryProduct;
  stock: number;
  safetyStock: number;
  hasNegativeWarning?: boolean;
  status: StockStatusType;
  daysOfStock?: number | null;
  recommendedOrder?: number;
}) {
  const cfg = STATUS_CONFIG[status];
  const displayStock = Number.isFinite(stock) ? Math.floor(stock) : 0;
  const shortfall = safetyStock > 0 && displayStock < safetyStock
    ? Math.max(0, safetyStock - displayStock)
    : 0;
  const simplifiedName = simplifyProductName(String(product.product_name ?? product.product_code ?? ""));

  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-card transition-shadow hover:shadow-card-hover">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0 flex-1 overflow-hidden">
          <div
            className="line-clamp-2 text-[13px] font-semibold leading-snug text-slate-800 md:text-sm"
            title={String(product.product_name ?? product.product_code ?? "").trim() || "-"}
          >
            {simplifiedName || String(product.product_name ?? product.product_code ?? "").trim() || "-"}
          </div>
          <div className="mt-0.5 truncate text-xs text-slate-500" title={product.product_code}>
            바코드 {String(product.product_code ?? "").trim() || "-"}
          </div>
        </div>
        <span
          className={`shrink-0 rounded-lg border px-2 py-0.5 text-[10px] font-bold uppercase ${cfg.className}`}
        >
          {cfg.label}
        </span>
      </div>
      <div className="mt-4 flex min-w-0 flex-col gap-1">
        <div className="min-w-0 truncate text-xs text-slate-500">
          {String(product.group_name ?? "").trim()}
          {product.sub_group && ` · ${String(product.sub_group).trim()}`}
        </div>
        <div className="flex min-w-0 flex-col items-end gap-0.5">
          <div className="flex min-w-0 items-baseline justify-between gap-2 w-full">
            <div className="min-w-0 text-right flex-1">
              <div className="text-sm text-slate-600">
                현재 재고: <span className="font-semibold tabular-nums text-slate-800">{displayStock.toLocaleString()}EA</span>
                {(product.pack_size ?? 0) > 0 && (
                  <span className="ml-1.5 text-slate-500">
                    / SKU: <span className="font-medium tabular-nums text-slate-800">{Math.floor(displayStock / (product.pack_size ?? 1)).toLocaleString()}박스</span>
                  </span>
                )}
                {daysOfStock != null && daysOfStock > 0 && (
                  <span className="ml-1.5 text-slate-500">
                    / 보유: <span className="font-medium tabular-nums text-slate-800">{daysOfStock.toFixed(1)}일</span>
                  </span>
                )}
                {shortfall > 0 && (
                  <span className="ml-1.5 text-red-400">
                    / 부족: <span className="font-medium tabular-nums">{shortfall.toLocaleString()}EA</span>
                  </span>
                )}
              </div>
            </div>
            {hasNegativeWarning && (
              <span className="shrink-0 text-amber-400" role="img" aria-label="경고">
                ⚠️
              </span>
            )}
          </div>
            {recommendedOrder != null && recommendedOrder > 0 && (
            <div className="mt-1 w-full rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1.5 text-right">
              <span className="text-xs text-indigo-600">권장 발주량</span>
              <span className="ml-2 text-sm font-bold tabular-nums text-indigo-700">
                {recommendedOrder.toLocaleString()}개
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
