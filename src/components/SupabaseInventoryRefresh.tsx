"use client";

import { useInventory } from "@/context/InventoryContext";
import { useState } from "react";

export function SupabaseInventoryRefresh() {
  const { useSupabaseInventory, refresh } = useInventory();
  const [loading, setLoading] = useState(false);

  if (!useSupabaseInventory) return null;

  const handleRefresh = async () => {
    setLoading(true);
    try {
      await refresh();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-2 flex items-center gap-2">
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
    </div>
  );
}
