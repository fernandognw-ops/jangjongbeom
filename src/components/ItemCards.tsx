"use client";

import { useInventory } from "@/context/InventoryContext";
import { ITEMS } from "@/lib/types";
import { getItemValue } from "@/lib/store";

export function ItemCards() {
  const { stock, productCostMap, safetyStockMap } = useInventory();

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {ITEMS.map((item) => {
        const qty = stock[item.id] ?? 0;
        const unitCost = productCostMap?.[item.id] ?? item.unitCost;
        const value = getItemValue(item.id, qty, unitCost);
        const safetyStock = safetyStockMap?.[item.id] ?? 0;
        const isShort = safetyStock > 0 && qty < safetyStock;
        return (
          <div
            key={item.id}
            className={`rounded-xl border p-5 transition-colors ${
              isShort
                ? "border-amber-500/50 bg-amber-500/5"
                : "border-surface-border bg-surface-card"
            }`}
            style={{
              backgroundColor: isShort ? undefined : "#18181b",
              borderColor: isShort ? undefined : "#27272a",
            }}
          >
            <div className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-400">
              {item.name}
            </div>
            <div className="text-2xl font-bold tabular-nums text-white">
              {qty.toLocaleString()}개
            </div>
            <div className="mt-1 text-sm text-zinc-400">
              원가 기준 {value.toLocaleString()}원
            </div>
            {isShort && safetyStock > 0 && (
              <div className="mt-2 text-xs text-amber-400">
                2주 안전재고 {safetyStock}개 미달
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
