"use client";

import { useMemo } from "react";
import { useInventory } from "@/context/InventoryContext";
import {
  predictAllRunOutDates,
  getTodayOutboundByItem,
  computeRealTimeAvailableStock,
} from "@/lib/inventoryCalculations";
import { ITEMS } from "@/lib/types";

export function RunOutDateCard() {
  const { stock, transactions } = useInventory();

  const predictions = useMemo(() => {
    const itemNames: Record<string, string> = {};
    for (const item of ITEMS) {
      itemNames[item.id] = item.name;
    }
    return predictAllRunOutDates(stock, transactions, itemNames, 30);
  }, [stock, transactions]);

  const todayOutByItem = useMemo(
    () => getTodayOutboundByItem(transactions),
    [transactions]
  );

  const realTimeAvailable = useMemo(() => {
    const result: Record<string, number> = {};
    for (const item of ITEMS) {
      const current = stock[item.id] ?? 0;
      const todayOut = todayOutByItem[item.id] ?? { coupang: 0, general: 0 };
      result[item.id] = computeRealTimeAvailableStock(
        current,
        todayOut,
        new Date()
      );
    }
    return result;
  }, [stock, todayOutByItem]);

  const urgentCount = predictions.filter((p) => p.isUrgent).length;
  const hasUrgent = urgentCount > 0;

  return (
    <section
      className={`mb-3 overflow-hidden rounded-lg border p-3 md:mb-6 md:rounded-xl md:p-6 ${
        hasUrgent
          ? "border-rose-500/50 bg-rose-500/5"
          : "border-emerald-500/40 bg-emerald-500/5"
      }`}
      style={{
        backgroundColor: hasUrgent
          ? "rgba(244, 63, 94, 0.08)"
          : "rgba(16, 185, 129, 0.08)",
        borderColor: hasUrgent
          ? "rgba(244, 63, 94, 0.5)"
          : "rgba(16, 185, 129, 0.4)",
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-300 md:text-sm">
            📅 재고 소진일 예측 (Run-out Date)
          </h2>
          <p className="mt-0.5 text-[10px] text-zinc-500 md:mt-1 md:text-sm">
            최근 30일 출고 평균 기준 · 물류센터 마감 시차 보정
          </p>
        </div>
        {hasUrgent && (
          <span className="shrink-0 rounded-full bg-rose-500/30 px-2 py-0.5 text-[10px] font-medium text-rose-300 md:text-xs">
            {urgentCount}개 품목 7일 이내 소진 예상
          </span>
        )}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 md:mt-4">
        {predictions.map((p) => (
          <div
            key={p.itemId}
            className={`rounded-lg border p-3 transition-colors ${
              p.isUrgent
                ? "border-rose-500/40 bg-rose-500/10"
                : "border-zinc-700/50 bg-zinc-800/30"
            }`}
          >
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-zinc-400 md:text-xs">
              {p.itemName}
            </div>
            <div className="flex flex-wrap items-baseline gap-1">
              <span className="text-[10px] text-zinc-500 md:text-xs">
                현재고: {p.currentStock.toLocaleString()}개
              </span>
              {realTimeAvailable[p.itemId] !== p.currentStock && (
                <span className="text-[10px] text-cyan-400 md:text-xs">
                  (가용: {realTimeAvailable[p.itemId]?.toLocaleString() ?? 0})
                </span>
              )}
            </div>
            <div className="mt-1 text-[10px] text-zinc-500 md:text-xs">
              일평균 출고: {p.avgDailyOut.toFixed(1)}개
            </div>
            <div
              className={`mt-2 font-bold md:text-lg ${
                p.isUrgent ? "text-rose-400" : p.isInfinite ? "text-emerald-400" : "text-white"
              }`}
            >
              {p.isInfinite ? (
                "소진 예상 없음"
              ) : (
                <>
                  {p.runOutDate} ({p.daysLeft}일 후)
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
