"use client";

import { lazy, Suspense } from "react";
import { useInventory } from "@/context/InventoryContext";
import { ShortageList } from "@/components/ShortageList";
import { RunOutDateCard } from "@/components/RunOutDateCard";
import { ItemCards } from "@/components/ItemCards";
import { BaseStockAndDailyStock } from "@/components/BaseStockAndDailyStock";
import { TransactionTable } from "@/components/TransactionTable";
import { DataManagement } from "@/components/DataManagement";
import { SyncSettings } from "@/components/SyncSettings";
import { DashboardBoxHero } from "@/components/DashboardBoxHero";
import { ProductionSheetUploader } from "@/components/ProductionSheetUploader";

const CategoryTrendChart = lazy(() =>
  import("@/components/CategoryTrendChart").then((m) => ({ default: m.CategoryTrendChart }))
);
const AIForecastReport = lazy(() =>
  import("@/components/AIForecastReport").then((m) => ({ default: m.AIForecastReport }))
);

function SupabaseDiagnosticBanner() {
  const { useSupabaseInventory, supabaseFetchStatus, supabaseFetchError, refresh } = useInventory();
  if (useSupabaseInventory || supabaseFetchStatus === "idle" || supabaseFetchStatus === "ok") return null;

  const messages: Record<string, { title: string; desc: string }> = {
    supabase_not_configured: {
      title: "Supabase 미설정",
      desc: ".env.local에 NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY를 추가하고 개발 서버를 재시작하세요. 478건 품목·775,564,288원 재고는 Supabase 연동 후 표시됩니다.",
    },
    fetch_error: {
      title: "Supabase 조회 실패",
      desc: supabaseFetchError ?? "inventory_products, inventory_inbound, inventory_outbound 테이블 및 RLS 정책을 확인하세요.",
    },
    empty_data: {
      title: "Supabase 연결됨, 데이터 없음",
      desc: "inventory_products, inventory_inbound, inventory_outbound 테이블에 데이터를 넣거나, sync_0311_current.py로 재고 스냅샷을 동기화한 뒤 새로고침하세요.",
    },
  };
  const msg = messages[supabaseFetchStatus];
  if (!msg) return null;

  return (
    <div
      className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 md:mb-6 md:rounded-xl md:p-4"
      role="alert"
    >
      <h3 className="text-sm font-semibold text-amber-400">{msg.title}</h3>
      <p className="mt-1 text-xs text-zinc-400 md:text-sm">{msg.desc}</p>
      <button
        type="button"
        onClick={() => refresh()}
        className="mt-2 text-xs text-cyan-400 hover:underline"
      >
        새로고침
      </button>
    </div>
  );
}

export default function DashboardPage() {
  const { totalValue, useSupabaseInventory, isSupabaseLoading, supabaseFetchStatus, refresh, kpiData } = useInventory();

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
        {isSupabaseLoading && supabaseFetchStatus === "idle" ? (
          <div className="rounded-2xl border border-zinc-700 bg-zinc-900/50 py-16 text-center">
            <p className="text-zinc-400">데이터 로딩 중입니다…</p>
            <p className="mt-2 text-xs text-zinc-500">15초 이상 걸리면 자동으로 종료됩니다. 아래 버튼으로 재시도할 수 있습니다.</p>
            <button
              type="button"
              onClick={() => refresh()}
              className="mt-4 rounded-lg bg-cyan-500/20 px-4 py-2 text-sm text-cyan-400 hover:bg-cyan-500/30"
            >
              새로고침
            </button>
          </div>
        ) : useSupabaseInventory ? (
          /* 박스히어로 스타일 대시보드 (Supabase inventory_* 연동 시) */
          <>
            {/* KPI 카드: snapshot 단일 출처 (재고 금액, 품목 수, 수량 EA, SKU 박스) */}
            {(kpiData || totalValue > 0) && (
              <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 md:gap-4">
                <div
                  className="min-w-0 overflow-hidden rounded-xl border p-4 md:p-6"
                  style={{
                    background: "linear-gradient(to bottom right, rgba(34, 211, 238, 0.15), #0a0a0b)",
                    borderColor: "rgba(34, 211, 238, 0.4)",
                  }}
                >
                  <div className="text-[10px] font-medium uppercase tracking-wider text-cyan-400 md:text-xs">
                    총 재고 금액
                  </div>
                  <div
                    className={`mt-1 min-w-0 overflow-hidden font-bold tabular-nums text-white md:mt-2 md:text-2xl lg:text-3xl ${
                      (kpiData?.totalValue ?? totalValue) >= 1000000000 ? "text-lg md:text-2xl" : ""
                    }`}
                    style={{ wordBreak: "break-word" }}
                  >
                    {(kpiData?.totalValue ?? totalValue).toLocaleString()}원
                  </div>
                </div>
                <div className="min-w-0 overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900/50 p-4 md:p-6">
                  <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-400 md:text-xs">
                    품목 수
                  </div>
                  <div className="mt-1 font-bold tabular-nums text-white md:mt-2 md:text-2xl lg:text-3xl">
                    {(kpiData?.productCount ?? 0).toLocaleString()}건
                  </div>
                </div>
                <div className="min-w-0 overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900/50 p-4 md:p-6">
                  <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-400 md:text-xs">
                    총 재고 수량 (EA)
                  </div>
                  <div className="mt-1 font-bold tabular-nums text-white md:mt-2 md:text-2xl lg:text-3xl">
                    {(kpiData?.totalQuantity ?? 0).toLocaleString()}EA
                  </div>
                </div>
                <div className="min-w-0 overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900/50 p-4 md:p-6">
                  <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-400 md:text-xs">
                    SKU (박스)
                  </div>
                  <div className="mt-1 font-bold tabular-nums text-white md:mt-2 md:text-2xl lg:text-3xl">
                    {(kpiData?.totalSku ?? 0).toLocaleString()}박스
                  </div>
                </div>
              </div>
            )}
            <div className="mb-6">
              <ProductionSheetUploader />
            </div>
            <DashboardBoxHero />
            {/* 카테고리 트렌드·AI 예측 (비동기 로딩) */}
            <Suspense
              fallback={
                <div className="mt-8 rounded-2xl border border-zinc-700 bg-zinc-900/50 py-12 text-center text-zinc-500">
                  차트 로딩 중…
                </div>
              }
            >
              <section className="mt-8 md:mt-10">
                <CategoryTrendChart />
              </section>
              <section className="mt-8 md:mt-10">
                <AIForecastReport />
              </section>
            </Suspense>
          </>
        ) : (
          /* 기존 대시보드 (localStorage/sync) */
          <>
            <div className="mb-3 md:mb-6">
              <SyncSettings />
            </div>
            <SupabaseDiagnosticBanner />

            <div
              className="mb-3 min-w-0 overflow-hidden rounded-lg border p-3 md:mb-6 md:rounded-xl md:p-6"
              style={{
                background: "linear-gradient(to bottom right, rgba(34, 211, 238, 0.15), #0a0a0b)",
                borderColor: "rgba(34, 211, 238, 0.4)",
              }}
            >
              <div className="text-[10px] font-medium uppercase tracking-wider text-cyan-400 md:text-xs">
                재고 금액
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
