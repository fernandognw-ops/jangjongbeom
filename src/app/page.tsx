"use client";

import { useInventory } from "@/context/InventoryContext";
import { ShortageList } from "@/components/ShortageList";
import { RunOutDateCard } from "@/components/RunOutDateCard";
import { ItemCards } from "@/components/ItemCards";
import { BaseStockAndDailyStock } from "@/components/BaseStockAndDailyStock";
import { TransactionTable } from "@/components/TransactionTable";
import { DataManagement } from "@/components/DataManagement";
import { SyncSettings } from "@/components/SyncSettings";
import { DashboardBoxHero } from "@/components/DashboardBoxHero";

export default function DashboardPage() {
  const { totalValue, useSupabaseInventory } = useInventory();

  return (
    <div
      className="min-h-screen bg-[#0a0a0b]"
      style={{ minHeight: "100vh", backgroundColor: "#0a0a0b", color: "#fafafa" }}
    >
      <header
        className="sticky top-0 z-10 border-b border-surface-border bg-surface/95 backdrop-blur pt-[env(safe-area-inset-top)]"
        style={{ backgroundColor: "rgba(10,10,11,0.98)", borderBottom: "1px solid #3f3f46" }}
      >
        <div className="mx-auto max-w-6xl px-3 py-2 md:px-6 md:py-3">
          <h1 className="text-sm font-semibold leading-tight text-white md:text-xl">
            실시간 통합 수불관리 시스템
          </h1>
          <p className="mt-0.5 text-[10px] text-zinc-400 md:text-sm">
            제조·유통 재고 자산 및 입출고 관리
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-6xl min-w-0 px-3 py-3 md:px-6 md:py-8 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pb-[max(1rem,env(safe-area-inset-bottom))]">
        {useSupabaseInventory ? (
          /* 박스히어로 스타일 대시보드 (Supabase inventory_* 연동 시) */
          <DashboardBoxHero />
        ) : (
          /* 기존 대시보드 (localStorage/sync) */
          <>
            <div className="mb-3 md:mb-6">
              <SyncSettings />
            </div>

            <div
              className="mb-3 min-w-0 overflow-hidden rounded-lg border p-3 md:mb-6 md:rounded-xl md:p-6"
              style={{
                background: "linear-gradient(to bottom right, rgba(34, 211, 238, 0.15), #0a0a0b)",
                borderColor: "rgba(34, 211, 238, 0.4)",
              }}
            >
              <div className="text-[10px] font-medium uppercase tracking-wider text-cyan-400 md:text-xs">
                현재 총 재고 자산 가치 (원가 기준)
              </div>
              <div
                className={`mt-1 min-w-0 overflow-hidden font-bold tabular-nums text-white md:mt-2 md:text-4xl ${
                  totalValue >= 1000000000 ? "text-lg md:text-3xl" : totalValue >= 1000000 ? "text-xl md:text-4xl" : "text-2xl"
                }`}
                style={{ wordBreak: "break-word" }}
              >
                {totalValue.toLocaleString()}원
              </div>
            </div>

            <div className="mb-3 md:mb-6">
              <ShortageList />
            </div>

            <div className="mb-3 md:mb-6">
              <RunOutDateCard />
            </div>

            <div className="mb-3 md:mb-8">
              <BaseStockAndDailyStock />
            </div>

            <div className="mb-3 md:mb-8">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400 md:mb-4 md:text-sm">
                품목별 재고 현황
              </h2>
              <ItemCards />
            </div>

            <div className="mb-3 md:mb-8">
              <DataManagement />
            </div>

            <TransactionTable />
          </>
        )}

        {/* Supabase 사용 시: 소진일 예측·데이터 관리·입출고 */}
        {useSupabaseInventory && (
          <div className="mt-12 space-y-8 border-t border-zinc-700 pt-8">
            <RunOutDateCard />
            <DataManagement />
            <TransactionTable />
          </div>
        )}
      </main>
    </div>
  );
}
