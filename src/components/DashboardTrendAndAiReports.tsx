"use client";

import { lazy, Suspense } from "react";

const CategoryTrendChart = lazy(() =>
  import("@/components/CategoryTrendChart").then((m) => ({ default: m.CategoryTrendChart }))
);
const AIForecastReport = lazy(() =>
  import("@/components/AIForecastReport").then((m) => ({ default: m.AIForecastReport }))
);

const chartSuspenseFallback = (
  <div className="mt-8 rounded-2xl border border-slate-200 bg-white py-12 text-center text-slate-500 shadow-card md:mt-10">
    차트 로딩 중…
  </div>
);

const aiSuspenseFallback = (
  <div className="mt-8 rounded-2xl border border-slate-200 bg-white py-12 text-center text-slate-500 shadow-card md:mt-10">
    AI 보고 로딩 중…
  </div>
);

/**
 * 카테고리 추세 차트 + AI 예측보고는 이 파일에서만 마운트합니다.
 * page·다른 섹션에 동일 컴포넌트를 두면 화면 순서가 꼬이고 이중 로딩이 납니다.
 */
export function DashboardTrendAndAiReports() {
  return (
    <>
      {/* 예전 위치에 남아있으면 무조건 순서 꼬임 — CategoryTrendChart / AIForecastReport 는 여기만 */}
      <Suspense fallback={chartSuspenseFallback}>
        <CategoryTrendChart />
      </Suspense>
      <Suspense fallback={aiSuspenseFallback}>
        <AIForecastReport />
      </Suspense>
    </>
  );
}
