"use client";

import { useMemo } from "react";
import { useInventory } from "@/context/InventoryContext";
import { mapGroupToItemId } from "@/lib/csvImport";

export function ShortageList() {
  const { stock, safetyStockMap, products } = useInventory();

  const shortageCount = useMemo(() => {
    let count = 0;
    for (const p of products) {
      const itemId = mapGroupToItemId(p.group);
      const current = stock[itemId] ?? 0;
      const safety = safetyStockMap?.[itemId] ?? 0;
      if (safety > 0 && current < safety) count++;
    }
    return count;
  }, [products, stock, safetyStockMap]);

  if (shortageCount === 0) return null;

  return (
    <section className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2 md:rounded-xl md:p-5" style={{ backgroundColor: "rgba(245, 158, 11, 0.08)", borderColor: "rgba(245, 158, 11, 0.5)" }}>
      <h2 className="text-[10px] font-semibold uppercase tracking-wider text-amber-400 md:text-sm">
        ⚠ 2주 안전재고 미달
      </h2>
      <p className="mt-1 text-xs leading-snug text-zinc-300 md:mt-2 md:text-sm">
        {shortageCount}개 품목 미달. <span className="font-medium text-amber-400">데이터 관리</span>에서 확인.
      </p>
    </section>
  );
}
