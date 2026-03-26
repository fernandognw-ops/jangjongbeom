"use client";

import { useInventory } from "@/context/InventoryContext";

function safeNumber(value: unknown): number {
  return Number(value ?? 0) || 0;
}

export function TotalInventorySummary() {
  const ctx = useInventory();
  const totalValue = ctx?.totalValue ?? 0;
  const useSupabaseInventory = ctx?.useSupabaseInventory ?? false;
  const kpiData = ctx?.kpiData;
  const refresh = ctx?.refresh ?? (() => window.location.reload());

  return (
    <section
      className="mt-6 min-h-[4rem] scroll-mt-24 md:mt-8"
      id="section-total-inventory-value"
      aria-labelledby="heading-total-inventory-value"
    >
      <h2
        id="heading-total-inventory-value"
        className="mb-3 text-base font-bold text-slate-800 md:text-lg"
      >
        총 재고 금액
      </h2>
      <div className="min-h-[120px] rounded-2xl border border-dashed border-slate-200/80 bg-white/40 p-2 md:p-0 md:border-0 md:bg-transparent">
        {useSupabaseInventory ? (
          <>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-slate-500">데이터가 안 바뀌면 →</span>
              <button
                type="button"
                onClick={() => refresh()}
                className="rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-600"
              >
                데이터 새로고침
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:gap-4">
              <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-card md:p-6">
                <div className="text-[10px] font-medium uppercase tracking-wider text-indigo-600 md:text-xs">
                  총 재고 금액
                </div>
                <div
                  className={`mt-1 min-w-0 overflow-hidden font-bold tabular-nums text-slate-800 md:mt-2 md:text-2xl lg:text-3xl ${
                    (kpiData?.totalValue ?? totalValue) >= 1000000000 ? "text-lg md:text-2xl" : ""
                  }`}
                  style={{ wordBreak: "break-word" }}
                >
                  {safeNumber(kpiData?.totalValue ?? totalValue).toLocaleString()}원
                </div>
              </div>
              <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-card md:p-6">
                <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500 md:text-xs">
                  품목 수
                </div>
                <div className="mt-1 font-bold tabular-nums text-slate-800 md:mt-2 md:text-2xl lg:text-3xl">
                  {safeNumber(kpiData?.productCount).toLocaleString()}건
                </div>
              </div>
              <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-card md:p-6">
                <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500 md:text-xs">
                  총 재고 수량 (EA)
                </div>
                <div className="mt-1 font-bold tabular-nums text-slate-800 md:mt-2 md:text-2xl lg:text-3xl">
                  {safeNumber(kpiData?.totalQuantity).toLocaleString()}EA
                </div>
              </div>
              <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-card md:p-6">
                <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500 md:text-xs">
                  SKU (박스)
                </div>
                <div className="mt-1 font-bold tabular-nums text-slate-800 md:mt-2 md:text-2xl lg:text-3xl">
                  {safeNumber(kpiData?.totalSku).toLocaleString()}박스
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 shadow-card md:p-6">
            <div className="text-[10px] font-medium uppercase tracking-wider text-indigo-600 md:text-xs">
              총 재고 금액
            </div>
            <div
              className={`mt-1 min-w-0 overflow-hidden font-bold tabular-nums text-slate-800 md:mt-2 md:text-4xl ${
                safeNumber(totalValue) >= 1000000000
                  ? "text-lg md:text-3xl"
                  : safeNumber(totalValue) >= 1000000
                    ? "text-xl md:text-4xl"
                    : "text-2xl"
              }`}
              style={{ wordBreak: "break-word" }}
            >
              {safeNumber(totalValue).toLocaleString()}원
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
