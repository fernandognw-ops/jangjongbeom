"use client";

import { useEffect } from "react";
import { useInventory } from "@/context/InventoryContext";
import { DashboardBoxHero } from "@/components/DashboardBoxHero";
import { TopSkuByCategoryDashboard } from "@/components/TopSkuByCategoryDashboard";
import { RuntimeErrorLogger } from "@/components/RuntimeErrorLogger";
import { TotalInventorySummary } from "@/components/TotalInventorySummary";
import { ProductionSheetUpload } from "@/components/ProductionSheetUpload";
import { OtherEtcSection } from "@/components/OtherEtcSection";
import { DashboardTrendAndAiReports } from "@/components/DashboardTrendAndAiReports";

function SupabaseDiagnosticBanner() {
  const { supabaseFetchStatus, supabaseFetchError, refresh } = useInventory();
  if (supabaseFetchStatus === "idle" || supabaseFetchStatus === "ok" || supabaseFetchStatus === "success") return null;

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
  const safeNumber = (value: unknown): number => Number(value ?? 0) || 0;
  const totalValue = ctx?.totalValue ?? 0;
  const useSupabaseInventory = ctx?.useSupabaseInventory ?? false;
  const isSupabaseLoading = ctx?.isSupabaseLoading ?? false;
  const supabaseFetchStatus = ctx?.supabaseFetchStatus ?? "idle";
  const nonBlockingError = ctx?.supabaseNonBlockingError;
  const blockingError = ctx?.supabaseFetchError;
  const hasAnyErrorBanner = Boolean(nonBlockingError || blockingError);
  const kpiData = ctx?.kpiData;
  const refresh = ctx?.refresh ?? (() => window.location.reload());

  useEffect(() => {
    if (typeof window === "undefined") return;
    const uploadVisible =
      useSupabaseInventory &&
      (supabaseFetchStatus === "empty_data" || supabaseFetchStatus === "ok" || supabaseFetchStatus === "success");
    console.log("[Dashboard] 데이터 소스 디버그", {
      supabaseFetchStatus,
      supabaseFetchError: ctx?.supabaseFetchError ?? "",
      useSupabaseInventory,
      kpiData: kpiData ?? null,
      totalValue: safeNumber(totalValue),
      uploadUI: uploadVisible ? "표시" : "숨김",
      uploadReason: !useSupabaseInventory
        ? "localStorage 모드"
        : supabaseFetchStatus === "empty_data"
          ? "DB 0건"
          : supabaseFetchStatus === "ok" || supabaseFetchStatus === "success"
            ? "데이터 있음(하단)"
            : "fetch_error 등",
    });
  }, [supabaseFetchStatus, ctx?.supabaseFetchError, useSupabaseInventory, kpiData, totalValue]);

  return (
    <div
      className="min-h-screen bg-[#E0E7FF]"
      style={{ minHeight: "100vh", backgroundColor: "#E0E7FF", color: "#1e293b" }}
    >
      <RuntimeErrorLogger />
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
        {hasAnyErrorBanner && (
          <div style={{ background: "#ffe5e5", color: "#d00", padding: "10px", marginBottom: "12px", borderRadius: "10px" }}>
            데이터 일부 로딩 실패 (대시보드는 계속 표시됩니다)
            {blockingError || nonBlockingError ? `: ${blockingError ?? nonBlockingError}` : ""}
          </div>
        )}
        {isSupabaseLoading && (
          <div className="mb-4 rounded-2xl border border-slate-200 bg-white py-6 px-4 text-center shadow-card">
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
        )}
        {useSupabaseInventory && <SupabaseDiagnosticBanner />}

        {/* 순서: 생산수불 업로드 → 총 재고 금액(KPI) → 재고 대시보드 → … */}
        <ProductionSheetUpload />
        <TotalInventorySummary />
        <DashboardBoxHero />
        <TopSkuByCategoryDashboard />
        <DashboardTrendAndAiReports />
        <OtherEtcSection />
      </main>
    </div>
  );
}
