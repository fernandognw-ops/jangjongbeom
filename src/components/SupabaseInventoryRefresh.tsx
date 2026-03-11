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

  if (!useSupabaseInventory) return null;

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
      <span className="text-[10px] text-emerald-400 md:text-xs">
        Supabase inventory_* 테이블 연동
      </span>
      <button
        type="button"
        onClick={handleRefresh}
        disabled={loading}
        className="rounded border border-cyan-500/50 bg-cyan-500/10 px-2 py-1 text-[10px] font-medium text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50 md:text-xs"
      >
        {loading ? "새로고침 중..." : "새로고침"}
      </button>
      <button
        type="button"
        onClick={handleDiag}
        disabled={diagLoading}
        className="rounded border border-zinc-500/50 bg-zinc-500/10 px-2 py-1 text-[10px] font-medium text-zinc-300 hover:bg-zinc-500/20 disabled:opacity-50 md:text-xs"
        title="Supabase 테이블 row 수 및 재고금액 확인"
      >
        {diagLoading ? "확인 중..." : "데이터 진단"}
      </button>
      <button
        type="button"
        onClick={handleTestAlert}
        disabled={alertLoading}
        className="rounded border border-amber-500/50 bg-amber-500/10 px-2 py-1 text-[10px] font-medium text-amber-300 hover:bg-amber-500/20 disabled:opacity-50 md:text-xs"
        title="품절 임박 핵심 품목(1,000만원+) 알림 테스트"
      >
        {alertLoading ? "확인 중..." : "알림 테스트"}
      </button>
      {(alertResult || diagResult) && (
        <span className="text-[10px] text-zinc-400">{diagResult ?? alertResult}</span>
      )}
    </div>
  );
}
