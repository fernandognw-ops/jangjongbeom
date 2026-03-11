"use client";

import { useInventory } from "@/context/InventoryContext";
import { ITEMS } from "@/lib/types";
import { getItemValue } from "@/lib/store";

export function ItemCards() {
  const { stock, productCostMap, safetyStockMap } = useInventory();

  return (
    <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 md:gap-4">
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
            className={`flex min-h-[80px] flex-col overflow-hidden rounded-lg border p-2 transition-colors md:min-h-[120px] md:p-5 md:rounded-xl ${
              isShort
                ? "border-amber-500/50 bg-amber-500/5"
                : "border-surface-border bg-surface-card"
            }`}
            style={{
              backgroundColor: isShort ? undefined : "#18181b",
              borderColor: isShort ? undefined : "#27272a",
            }}
          >
            <div className="mb-0.5 shrink-0 text-[10px] font-medium uppercase tracking-wider text-zinc-400 md:mb-2 md:text-xs">
              {item.name}
            </div>
            <div
              className={`min-w-0 overflow-hidden text-ellipsis tabular-nums font-bold text-white ${
                isLargeNumber ? "text-xs md:text-lg" : "text-sm md:text-2xl"
              }`}
              style={{ wordBreak: "break-word" }}
            >
              {qty.toLocaleString()}개
            </div>
            <div
              className={`mt-0.5 min-w-0 overflow-hidden text-ellipsis text-zinc-400 md:mt-2 md:text-sm ${
                value >= 1000000 ? "text-[10px] md:text-sm" : "text-[10px] md:text-base"
              }`}
              style={{ wordBreak: "break-word" }}
            >
              {value.toLocaleString()}원
            </div>
            {isShort && safetyStock > 0 && (
              <div className="mt-0.5 shrink-0 text-[10px] font-medium text-amber-400 md:mt-2 md:text-xs">
                안전재고 {safetyStock.toLocaleString()}개 미달
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
