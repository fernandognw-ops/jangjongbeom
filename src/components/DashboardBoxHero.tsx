"use client";

import { useMemo, useState } from "react";
import { useInventory } from "@/context/InventoryContext";
import { SupabaseInventoryRefresh } from "./SupabaseInventoryRefresh";
import { computeTotalValue } from "@/lib/inventoryApi";
import type { InventoryProduct } from "@/lib/inventoryApi";

type Channel = "all" | "coupang" | "general";

function getStockStatus(
  stock: number,
  safetyStock: number,
  hasNegativeWarning: boolean
): "normal" | "low" | "out" | "warning" {
  if (hasNegativeWarning) return "warning";
  if (stock <= 0) return "out";
  if (safetyStock > 0 && stock < safetyStock) return "low";
  return "normal";
}

/** 채널별 재고 합산 (전체 = 쿠팡 + 일반) */
function getStockByChannel(
  stockByProductByChannel: { coupang: Record<string, number>; general: Record<string, number> } | undefined,
  channel: Channel
): Record<string, number> {
  if (!stockByProductByChannel) return {};
  const { coupang, general } = stockByProductByChannel;
  if (channel === "coupang") return coupang;
  if (channel === "general") return general;
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
    stockByProductByChannel,
    safetyStockByProduct = {},
    todayInOutCount = { inbound: 0, outbound: 0 },
  } = useInventory();

  const [channel, setChannel] = useState<Channel>("all");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

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

  const totalValue = channelTotalValue;

  const categories = useMemo(() => {
    const set = new Set(inventoryProducts.map((p) => p.group_name));
    return Array.from(set).sort();
  }, [inventoryProducts]);

  const filteredProducts = useMemo(() => {
    let list = inventoryProducts;
    if (selectedCategory) {
      list = list.filter((p) => p.group_name === selectedCategory);
    }
    return list;
  }, [inventoryProducts, selectedCategory]);

  const nearOutCount = useMemo(() => {
    return inventoryProducts.filter((p) => {
      const stock = stockByProduct[p.code] ?? 0;
      const safety = safetyStockByProduct[p.code] ?? 0;
      return safety > 0 && stock < safety;
    }).length;
  }, [inventoryProducts, stockByProduct, safetyStockByProduct]);

  const negativeStockCount = useMemo(() => {
    return Object.values(stockByProductRaw).filter((q) => q < 0).length;
  }, [stockByProductRaw]);

  const channelTheme = {
    all: {
      border: "border-zinc-700",
      bg: "bg-zinc-900/50",
      accent: "cyan",
      totalBorder: "border-cyan-500/40",
      totalBg: "from-cyan-500/15",
      totalText: "text-cyan-400",
      tabActive: "bg-zinc-600 text-white",
    },
    coupang: {
      border: "border-orange-500/30",
      bg: "bg-orange-500/5",
      accent: "orange",
      totalBorder: "border-orange-500/40",
      totalBg: "from-orange-500/15",
      totalText: "text-orange-400",
      tabActive: "bg-orange-500/90 text-white",
    },
    general: {
      border: "border-sky-500/30",
      bg: "bg-sky-500/5",
      accent: "blue",
      totalBorder: "border-sky-500/40",
      totalBg: "from-sky-500/15",
      totalText: "text-sky-400",
      tabActive: "bg-sky-500/90 text-white",
    },
  };
  const theme = channelTheme[channel];

  if (!useSupabaseInventory || inventoryProducts.length === 0) {
    return null;
  }

  return (
    <div className={`space-y-6 rounded-2xl border ${theme.border} ${theme.bg} p-4 transition-colors md:p-6`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-bold text-white md:text-xl">
          재고 대시보드
        </h1>
        <SupabaseInventoryRefresh />
      </div>

      {/* 채널 탭: 전체 | 쿠팡 | 일반 */}
      <div className="flex gap-2 rounded-xl border border-zinc-700 bg-zinc-900/80 p-1">
        <button
          type="button"
          onClick={() => setChannel("all")}
          className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${
            channel === "all"
              ? "bg-zinc-600 text-white"
              : "text-zinc-400 hover:bg-zinc-800 hover:text-white"
          }`}
        >
          전체
        </button>
        <button
          type="button"
          onClick={() => setChannel("coupang")}
          className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${
            channel === "coupang"
              ? "bg-orange-500/90 text-white"
              : "text-zinc-400 hover:bg-zinc-800 hover:text-white"
          }`}
        >
          쿠팡 (Coupang)
        </button>
        <button
          type="button"
          onClick={() => setChannel("general")}
          className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${
            channel === "general"
              ? "bg-sky-500/90 text-white"
              : "text-zinc-400 hover:bg-zinc-800 hover:text-white"
          }`}
        >
          일반 (General)
        </button>
      </div>

      {/* 마이너스 재고 경고 */}
      {negativeStockCount > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 py-3">
          <span className="text-lg" role="img" aria-label="경고">
            ⚠️
          </span>
          <span className="text-sm text-amber-300">
            {channel === "all" ? "전체" : channel === "coupang" ? "쿠팡" : "일반"} 채널에서 입고 없이 출고만 있는 제품이 {negativeStockCount}건 있습니다. 재고는 0으로 표시됩니다.
          </span>
        </div>
      )}

      {/* 상단 요약 카드 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-zinc-700 bg-zinc-900/80 p-5 shadow-lg">
          <div className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            전체 품목 수
          </div>
          <div className="mt-2 text-3xl font-bold tabular-nums text-white">
            {inventoryProducts.length.toLocaleString()}건
          </div>
        </div>
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 shadow-lg">
          <div className="text-xs font-medium uppercase tracking-wider text-amber-400">
            품절 임박
          </div>
          <div className="mt-2 text-3xl font-bold tabular-nums text-amber-300">
            {nearOutCount.toLocaleString()}건
          </div>
          <div className="mt-1 text-[10px] text-zinc-500">
            재고 &lt; 안전재고
          </div>
        </div>
        <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-5 shadow-lg">
          <div className="text-xs font-medium uppercase tracking-wider text-emerald-400">
            오늘 입고
          </div>
          <div className="mt-2 text-3xl font-bold tabular-nums text-emerald-300">
            {todayInOutCount.inbound.toLocaleString()}건
          </div>
        </div>
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-5 shadow-lg">
          <div className="text-xs font-medium uppercase tracking-wider text-rose-400">
            오늘 출고
          </div>
          <div className="mt-2 text-3xl font-bold tabular-nums text-rose-300">
            {todayInOutCount.outbound.toLocaleString()}건
          </div>
        </div>
      </div>

      {/* 총 재고 금액 (채널별 실시간 재계산) */}
      <div className={`rounded-2xl border ${theme.totalBorder} bg-gradient-to-br ${theme.totalBg} to-transparent p-5`}>
        <div className={`text-xs font-medium uppercase tracking-wider ${theme.totalText}`}>
          총 재고 자산 가치 (원가 기준)
          {channel !== "all" && (
            <span className="ml-2 text-zinc-500">
              — {channel === "coupang" ? "쿠팡" : "일반"} 채널
            </span>
          )}
        </div>
        <div className="mt-1 text-2xl font-bold tabular-nums text-white md:text-3xl">
          {totalValue.toLocaleString()}원
        </div>
      </div>

      {/* 카테고리 탭 */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setSelectedCategory(null)}
          className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
            selectedCategory === null
              ? channel === "coupang"
                ? "bg-orange-500 text-white"
                : channel === "general"
                  ? "bg-sky-500 text-white"
                  : "bg-cyan-500 text-white"
              : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white"
          }`}
        >
          전체
        </button>
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setSelectedCategory(cat)}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
              selectedCategory === cat
                ? channel === "coupang"
                  ? "bg-orange-500 text-white"
                  : channel === "general"
                    ? "bg-sky-500 text-white"
                    : "bg-cyan-500 text-white"
                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* 제품 카드 그리드 */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filteredProducts.map((product) => {
          const rawStock = stockByProductRaw[product.code] ?? 0;
          const { display, hasWarning } = clampStock(rawStock);
          return (
            <ProductCard
              key={product.id}
              product={product}
              stock={display}
              safetyStock={safetyStockByProduct[product.code] ?? 0}
              hasNegativeWarning={hasWarning}
            />
          );
        })}
      </div>

      {filteredProducts.length === 0 && (
        <div className="rounded-2xl border border-zinc-700 bg-zinc-900/50 py-16 text-center text-zinc-500">
          해당 카테고리에 제품이 없습니다.
        </div>
      )}
    </div>
  );
}

function ProductCard({
  product,
  stock,
  safetyStock,
  hasNegativeWarning,
}: {
  product: InventoryProduct;
  stock: number;
  safetyStock: number;
  hasNegativeWarning?: boolean;
}) {
  const status = getStockStatus(stock, safetyStock, hasNegativeWarning ?? false);
  const statusConfig = {
    normal: {
      label: "정상",
      className: "bg-emerald-500/30 text-emerald-400 border-emerald-500/50",
    },
    low: {
      label: "부족",
      className: "bg-amber-500/30 text-amber-400 border-amber-500/50",
    },
    out: {
      label: "품절임박",
      className: "bg-rose-500/30 text-rose-400 border-rose-500/50",
    },
    warning: {
      label: "⚠️ 데이터 오류",
      className: "bg-amber-500/40 text-amber-300 border-amber-500/60",
    },
  };
  const cfg = statusConfig[status];

  return (
    <div className="flex flex-col rounded-2xl border border-zinc-700 bg-zinc-900/80 p-4 shadow-lg transition-shadow hover:shadow-xl">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-white">
            {product.name}
          </div>
          <div className="mt-0.5 text-xs text-zinc-500">
            SKU {product.code}
          </div>
        </div>
        <span
          className={`shrink-0 rounded-lg border px-2 py-0.5 text-[10px] font-bold uppercase ${cfg.className}`}
        >
          {cfg.label}
        </span>
      </div>
      <div className="mt-4 flex items-end justify-between">
        <div className="text-xs text-zinc-500">
          {product.group_name}
          {product.sub_group && ` · ${product.sub_group}`}
        </div>
        <div className="text-right">
          {hasNegativeWarning && (
            <span className="mr-1 text-amber-400" role="img" aria-label="경고">
              ⚠️
            </span>
          )}
          <div className="text-2xl font-bold tabular-nums text-white md:text-3xl">
            {stock.toLocaleString()}
          </div>
          <div className="text-[10px] text-zinc-500">개</div>
        </div>
      </div>
    </div>
  );
}
