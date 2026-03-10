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
    <section className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 md:p-5" style={{ backgroundColor: "rgba(245, 158, 11, 0.08)", borderColor: "rgba(245, 158, 11, 0.5)" }}>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-amber-400 md:text-sm">
        ⚠ 2주 안전재고 미달
      </h2>
      <p className="mt-2 text-base leading-relaxed text-zinc-200 md:mt-1 md:text-sm md:text-zinc-300">
        {shortageCount}개 품목이 안전재고 미달입니다. <span className="font-medium text-amber-400">데이터 관리</span>에서 상품명별 부족수량을 확인하세요.
      </p>
    </section>
  );
}
