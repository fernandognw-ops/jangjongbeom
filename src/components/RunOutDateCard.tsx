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
  const hasAnyStock = Object.values(stock).some((v) => v > 0);
  const hasAnyOutbound = predictions.some((p) => p.avgDailyOut > 0);

  return (
    <section
      className={`mb-3 overflow-hidden rounded-2xl border p-3 shadow-card md:mb-6 md:p-6 ${
        hasUrgent
          ? "border-rose-200 bg-rose-50"
          : "border-emerald-200 bg-emerald-50"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-600 md:text-sm">
            📅 재고 소진일 예측 (Run-out Date)
          </h2>
          <p className="mt-0.5 text-[10px] text-slate-500 md:mt-1 md:text-sm">
            최근 30일 출고 평균 기준 · 물류센터 마감 시차 보정
          </p>
        </div>
        {hasUrgent && (
          <span className="shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-medium text-rose-700 md:text-xs">
            {urgentCount}개 품목 7일 이내 소진 예상
          </span>
        )}
      </div>

      {!hasAnyStock && !hasAnyOutbound ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 md:p-5">
          <p className="text-sm text-amber-800">
            재고·출고 데이터가 없습니다. Supabase에 입출고·재고 스냅샷을 동기화한 뒤 새로고침하세요.
          </p>
          <p className="mt-2 text-xs text-slate-600">
            <code className="rounded bg-slate-200 px-1.5 py-0.5">npm run bulk-upload</code> 실행 후 대시보드 새로고침
          </p>
        </div>
      ) : (
        <div className="mt-3 grid min-w-0 grid-cols-1 gap-2 overflow-hidden sm:grid-cols-2 md:mt-4 lg:grid-cols-3 xl:grid-cols-5">
        {predictions.map((p) => (
          <div
            key={String(p.itemId)}
            className={`min-w-0 overflow-hidden rounded-xl border p-3 shadow-sm transition-colors ${
              p.isUrgent
                ? "border-rose-200 bg-rose-50"
                : "border-slate-200 bg-white"
            }`}
          >
            <div className="mb-1 truncate text-[10px] font-medium uppercase tracking-wider text-slate-600 md:text-xs">
              {String(p.itemName ?? p.itemId ?? "").trim() || "-"}
            </div>
            <div className="flex min-w-0 flex-wrap items-baseline gap-1 overflow-hidden">
              <span className="truncate text-[10px] text-slate-500 md:text-xs">
                현재고: {Number(p.currentStock).toLocaleString()}개
              </span>
              {realTimeAvailable[p.itemId] !== p.currentStock && (
                <span className="text-[10px] text-indigo-600 md:text-xs">
                  (가용: {realTimeAvailable[p.itemId]?.toLocaleString() ?? 0})
                </span>
              )}
            </div>
            <div className="mt-1 truncate text-[10px] text-slate-500 md:text-xs">
              일평균 출고: {Number(p.avgDailyOut).toFixed(1)}개
            </div>
            <div
              className={`mt-2 truncate font-bold md:text-lg ${
                p.isUrgent ? "text-rose-700" : p.isInfinite ? "text-emerald-700" : "text-slate-800"
              }`}
            >
              {p.isInfinite ? (
                "소진 예상 없음"
              ) : (
                <>
                  {p.runOutDate} ({Math.floor(Number(p.daysLeft))}일 후)
                </>
              )}
            </div>
          </div>
        ))}
        </div>
      )}
    </section>
  );
}
