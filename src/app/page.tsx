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
import { TopSkuByCategoryDashboard } from "@/components/TopSkuByCategoryDashboard";

const CategoryTrendChart = lazy(() =>
  import("@/components/CategoryTrendChart").then((m) => ({ default: m.CategoryTrendChart }))
);
const AIForecastReport = lazy(() =>
  import("@/components/AIForecastReport").then((m) => ({ default: m.AIForecastReport }))
);

function SupabaseDiagnosticBanner() {
  const { supabaseFetchStatus, supabaseFetchError, refresh } = useInventory();
  if (supabaseFetchStatus === "idle" || supabaseFetchStatus === "ok") return null;

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
      desc: "아래 [생산수불현황 업로드]에서 Excel 파일을 드래그한 뒤 검증 → DB 반영을 클릭하세요.",
    },
  };
  const msg = messages[supabaseFetchStatus];
  if (!msg) return null;

  return (
    <div
      className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 shadow-card md:mb-6 md:p-4"
      role="alert"
    >
      <h3 className="text-sm font-semibold text-amber-800">{msg.title}</h3>
      <p className="mt-1 text-xs text-slate-600 md:text-sm">{msg.desc}</p>
      <button
        type="button"
        onClick={() => refresh()}
        className="mt-2 text-xs font-medium text-indigo-600 hover:underline"
      >
        새로고침
      </button>
    </div>
  );
}

export default function DashboardPage() {
  const ctx = useInventory();
  const totalValue = ctx?.totalValue ?? 0;
  const useSupabaseInventory = ctx?.useSupabaseInventory ?? false;
  const isSupabaseLoading = ctx?.isSupabaseLoading ?? false;
  const supabaseFetchStatus = ctx?.supabaseFetchStatus ?? "idle";
  const kpiData = ctx?.kpiData;
  const refresh = ctx?.refresh ?? (() => window.location.reload());

  return (
    <div
      className="min-h-screen bg-[#E0E7FF]"
      style={{ minHeight: "100vh", backgroundColor: "#E0E7FF", color: "#1e293b" }}
    >
      <header
        className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur shadow-sm pt-[env(safe-area-inset-top)]"
        style={{ backgroundColor: "rgba(255,255,255,0.98)", borderBottom: "1px solid #E2E8F0" }}
      >
        <div className="mx-auto max-w-6xl px-3 py-2 md:px-6 md:py-3">
          <h1 className="text-sm font-semibold leading-tight text-slate-800 md:text-xl">
            클라 물류 관리 시스템 (AI 기반 데이터 분석)
          </h1>
          <p className="mt-0.5 text-[10px] text-slate-500 md:text-sm">
            PC & 모바일 멀티 사용 가능 (모바일은 구글외 인터넷 상에서 보기에 편함)
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-6xl min-w-0 px-3 py-3 md:px-6 md:py-8 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pb-[max(1.5rem,env(safe-area-inset-bottom))] overflow-x-hidden">
        {isSupabaseLoading && supabaseFetchStatus === "idle" ? (
          <div className="rounded-2xl border border-slate-200 bg-white py-16 px-4 text-center shadow-card">
            <p className="text-slate-600">Supabase 데이터 로딩 중입니다…</p>
            <p className="mt-2 text-xs text-slate-500">모든 데이터는 Supabase에서 가져옵니다. 15초 이상 걸리면 아래 버튼으로 재시도하세요.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={() => refresh()}
                className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-600 shadow-sm"
              >
                새로고침
              </button>
              {!ctx?.supabaseSingleSource && (
                <button
                  type="button"
                  onClick={() => ctx?.switchToLocalMode?.()}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 shadow-sm"
                >
                  로컬 모드로 전환
                </button>
              )}
            </div>
          </div>
        ) : useSupabaseInventory ? (
          /* 박스히어로 스타일 대시보드 (Supabase 전용 - 모든 데이터 Supabase 출처) */
          <>
            <SupabaseDiagnosticBanner />
            {/* 데이터 없을 때 업로드 UI를 최상단에 배치 (가장 먼저 보이도록) */}
            {supabaseFetchStatus === "empty_data" && (
              <div className="mb-6">
                <ProductionSheetUploader />
              </div>
            )}
            {/* KPI 카드: snapshot 단일 출처 (재고 금액, 품목 수, 수량 EA, SKU 박스). DB 0건이어도 0으로 표시 */}
            {(kpiData != null || totalValue > 0 || supabaseFetchStatus === "empty_data") && (
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
              <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 md:gap-4">
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
                    {((kpiData?.totalValue ?? totalValue) ?? 0).toLocaleString()}원
                  </div>
                </div>
                <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-card md:p-6">
                  <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500 md:text-xs">
                    품목 수
                  </div>
                  <div className="mt-1 font-bold tabular-nums text-slate-800 md:mt-2 md:text-2xl lg:text-3xl">
                    {(kpiData?.productCount ?? 0).toLocaleString()}건
                  </div>
                </div>
                <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-card md:p-6">
                  <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500 md:text-xs">
                    총 재고 수량 (EA)
                  </div>
                  <div className="mt-1 font-bold tabular-nums text-slate-800 md:mt-2 md:text-2xl lg:text-3xl">
                    {(kpiData?.totalQuantity ?? 0).toLocaleString()}EA
                  </div>
                </div>
                <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-card md:p-6">
                  <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500 md:text-xs">
                    SKU (박스)
                  </div>
                  <div className="mt-1 font-bold tabular-nums text-slate-800 md:mt-2 md:text-2xl lg:text-3xl">
                    {(kpiData?.totalSku ?? 0).toLocaleString()}박스
                  </div>
                </div>
              </div>
              </>
            )}
            {/* 데이터 있을 때는 KPI 아래에 업로드 UI */}
            {supabaseFetchStatus !== "empty_data" && (
              <div className="mb-6">
                <ProductionSheetUploader />
              </div>
            )}
            <DashboardBoxHero />
            <section className="mt-8" id="top-sku-dashboard">
              <h2 className="mb-3 text-base font-bold text-slate-800 md:text-lg">
                카테고리별 주력 SKU 재고 관리
              </h2>
              <TopSkuByCategoryDashboard />
            </section>
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

            <div className="mb-3 min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 shadow-card md:mb-6 md:p-6">
              <div className="text-[10px] font-medium uppercase tracking-wider text-indigo-600 md:text-xs">
                재고 금액
              </div>
              <div
                className={`mt-1 min-w-0 overflow-hidden font-bold tabular-nums text-slate-800 md:mt-2 md:text-4xl ${
                  totalValue >= 1000000000 ? "text-lg md:text-3xl" : totalValue >= 1000000 ? "text-xl md:text-4xl" : "text-2xl"
                }`}
                style={{ wordBreak: "break-word" }}
              >
                {(totalValue ?? 0).toLocaleString()}원
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
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-600 md:mb-4 md:text-sm">
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
          <div className="mt-12 space-y-8 border-t border-slate-200 pt-8">
            <RunOutDateCard />
            <DataManagement />
            <TransactionTable />
          </div>
        )}
      </main>
    </div>
  );
}
