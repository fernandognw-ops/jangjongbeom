"use client";

import { useInventory } from "@/context/InventoryContext";
import { ITEMS } from "@/lib/types";
import { getItemValue } from "@/lib/store";

export function ItemCards() {
  const { stock, productCostMap, safetyStockMap } = useInventory();

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {ITEMS.map((item) => {
        const qty = stock[item.id] ?? 0;
        const unitCost = productCostMap?.[item.id] ?? item.unitCost;
        const value = getItemValue(item.id, qty, unitCost);
        const safetyStock = safetyStockMap?.[item.id] ?? 0;
        const isShort = safetyStock > 0 && qty < safetyStock;
        const isLargeNumber = qty >= 1000000 || value >= 1000000;
        return (
          <div
            key={item.id}
            className={`flex min-h-[120px] flex-col overflow-hidden rounded-xl border p-5 transition-colors md:min-h-0 md:p-5 ${
              isShort
                ? "border-amber-500/50 bg-amber-500/5"
                : "border-surface-border bg-surface-card"
            }`}
            style={{
              backgroundColor: isShort ? undefined : "#18181b",
              borderColor: isShort ? undefined : "#27272a",
            }}
          >
            <div className="mb-2 shrink-0 text-xs font-medium uppercase tracking-wider text-zinc-400 md:text-xs">
              {item.name}
            </div>
            <div
              className={`min-w-0 overflow-hidden text-ellipsis tabular-nums font-bold text-white md:text-2xl ${
                isLargeNumber ? "text-xl md:text-lg" : "text-3xl"
              }`}
              style={{ wordBreak: "break-word" }}
            >
              {qty.toLocaleString()}개
            </div>
            <div
              className={`mt-2 min-w-0 overflow-hidden text-ellipsis text-zinc-300 md:mt-1 md:text-sm md:text-zinc-400 ${
                value >= 1000000 ? "text-sm" : "text-base"
              }`}
              style={{ wordBreak: "break-word" }}
            >
              원가 기준 {value.toLocaleString()}원
            </div>
            {isShort && safetyStock > 0 && (
              <div className="mt-2 shrink-0 text-sm font-medium text-amber-400 md:text-xs">
                2주 안전재고 {safetyStock.toLocaleString()}개 미달
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
