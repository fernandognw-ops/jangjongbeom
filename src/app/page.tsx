"use client";

import { useInventory } from "@/context/InventoryContext";
import { ShortageList } from "@/components/ShortageList";
import { ItemCards } from "@/components/ItemCards";
import { BaseStockAndDailyStock } from "@/components/BaseStockAndDailyStock";
import { TransactionForm } from "@/components/TransactionForm";
import { TransactionTable } from "@/components/TransactionTable";
import { DataManagement } from "@/components/DataManagement";

export default function DashboardPage() {
  const { totalValue } = useInventory();

  return (
    <div
      className="min-h-screen bg-[#0a0a0b]"
      style={{ minHeight: "100vh", backgroundColor: "#0a0a0b", color: "#fafafa" }}
    >
      <header
        className="sticky top-0 z-10 border-b border-surface-border bg-surface/95 backdrop-blur pt-[env(safe-area-inset-top)]"
        style={{ backgroundColor: "rgba(10,10,11,0.95)", borderBottom: "1px solid #27272a" }}
      >
        <div className="mx-auto max-w-6xl px-4 py-3 sm:py-4 md:px-6">
          <h1 className="text-lg font-semibold tracking-tight text-white md:text-xl">
            실시간 통합 수불관리 시스템
          </h1>
          <p className="mt-0.5 text-xs text-zinc-400 md:text-sm">
            제조·유통 재고 자산 및 입출고 관리
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-4 sm:py-6 md:px-6 md:py-8 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {/* 총 재고 자산 가치 */}
        <div
          className="mb-6 rounded-xl border p-5 md:p-6"
          style={{
            background: "linear-gradient(to bottom right, rgba(34, 211, 238, 0.1), #0a0a0b)",
            borderColor: "rgba(34, 211, 238, 0.3)",
          }}
        >
          <div className="text-xs font-medium uppercase tracking-wider text-cyan-400/90">
            현재 총 재고 자산 가치 (원가 기준)
          </div>
          <div className="mt-1 text-3xl font-bold tabular-nums text-white md:text-4xl">
            {totalValue.toLocaleString()}원
          </div>
        </div>

        {/* 재고 부족 */}
        <div className="mb-6">
          <ShortageList />
        </div>

        {/* 3월 기초 재고 · 당일 재고 · 불일치 분석 */}
        <div className="mb-8">
          <BaseStockAndDailyStock />
        </div>

        {/* 품목별 재고 카드 */}
        <div className="mb-8">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-400">
            품목별 재고 현황
          </h2>
          <ItemCards />
        </div>

        {/* 입출고 입력 */}
        <div className="mb-8">
          <TransactionForm />
        </div>

        <div className="mb-8">
          <DataManagement />
        </div>

        {/* 입출고 내역 (최근 10건, 하단) */}
        <TransactionTable />
      </main>
    </div>
  );
}
