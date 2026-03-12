"use client";

import { useInventory } from "@/context/InventoryContext";
import { useState } from "react";

export function SupabaseInventoryRefresh() {
  const { useSupabaseInventory, refresh } = useInventory();
  const [loading, setLoading] = useState(false);
  const [alertLoading, setAlertLoading] = useState(false);
  const [alertResult, setAlertResult] = useState<string | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagResult, setDiagResult] = useState<string | null>(null);
  const [syncCatLoading, setSyncCatLoading] = useState(false);

  if (!useSupabaseInventory) return null;

  const handleSyncCategory = async () => {
    setSyncCatLoading(true);
    setDiagResult(null);
    try {
      const res = await fetch("/api/inventory/sync-category");
      const d = await res.json();
      if (d.ok) {
        setDiagResult(`카테고리 ${d.updated}건 동기화됨. 새로고침 버튼을 눌러주세요.`);
        setTimeout(() => refresh(), 500);
      } else {
        setDiagResult(d.error ?? "동기화 실패");
      }
    } catch (e) {
      setDiagResult(e instanceof Error ? e.message : "오류");
    } finally {
      setSyncCatLoading(false);
    }
  };

  const handleRefresh = async () => {
    setLoading(true);
    setAlertResult(null);
    try {
      await refresh();
    } finally {
      setLoading(false);
    }
  };

  const handleDiag = async () => {
    setDiagLoading(true);
    setDiagResult(null);
    try {
      const res = await fetch("/api/inventory-diag");
      const d = await res.json();
      if (d.ok) {
        const t = d.tables;
        setDiagResult(
          `현재품목 ${t.inventory_current_products}건 | 재고스냅샷 ${t.inventory_stock_snapshot}건 | 입고 ${t.inventory_inbound}건 | 출고 ${t.inventory_outbound}건 | 재고금액 ${d.totalValue?.toLocaleString() ?? 0}원`
        );
      } else {
        setDiagResult(d.error ?? "진단 실패");
      }
    } catch (e) {
      setDiagResult(e instanceof Error ? e.message : "오류");
    } finally {
      setDiagLoading(false);
    }
  };

  const handleTestAlert = async () => {
    setAlertLoading(true);
    setAlertResult(null);
    try {
      const res = await fetch("/api/stock-alerts");
      const data = await res.json();
      if (data.ok) {
        setAlertResult(
          data.alerted > 0
            ? `${data.alerted}건 알림 발송 (콘솔 확인)`
            : "알림 대상 없음"
        );
      } else {
        setAlertResult(data.error ?? "실패");
      }
    } catch (e) {
      setAlertResult(e instanceof Error ? e.message : "오류");
    } finally {
      setAlertLoading(false);
    }
  };

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <span className="text-[10px] text-emerald-600 md:text-xs">
        Supabase inventory_* 테이블 연동
      </span>
      <button
        type="button"
        onClick={handleRefresh}
        disabled={loading}
        className="rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1 text-[10px] font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 md:text-xs"
      >
        {loading ? "새로고침 중..." : "새로고침"}
      </button>
      <button
        type="button"
        onClick={handleSyncCategory}
        disabled={syncCatLoading}
        className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 md:text-xs"
        title="inventory_products.group_name → 재고스냅샷.category 동기화"
      >
        {syncCatLoading ? "동기화 중..." : "카테고리 동기화"}
      </button>
      <button
        type="button"
        onClick={handleDiag}
        disabled={diagLoading}
        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 md:text-xs"
        title="Supabase 테이블 row 수 및 재고금액 확인"
      >
        {diagLoading ? "확인 중..." : "데이터 진단"}
      </button>
      <button
        type="button"
        onClick={handleTestAlert}
        disabled={alertLoading}
        className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50 md:text-xs"
        title="품절 임박 핵심 품목(1,000만원+) 알림 테스트"
      >
        {alertLoading ? "확인 중..." : "알림 테스트"}
      </button>
      {(alertResult || diagResult) && (
        <span className="text-[10px] text-slate-600">{diagResult ?? alertResult}</span>
      )}
    </div>
  );
}
