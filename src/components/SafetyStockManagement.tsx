"use client";

import { useMemo, useState } from "react";
import { useInventory } from "@/context/InventoryContext";
import { mapGroupToItemId } from "@/lib/csvImport";
import { exportShortageToExcel } from "@/lib/excelExport";
import { ITEMS } from "@/lib/types";
import { formatProductDisplayName } from "@/lib/productNameFormatter";

type ShortageRow = {
  productName: string;
  productCode: string;
  categoryName: string;
  categoryId: string;
  currentStock: number;
  safetyStock: number;
  shortageQty: number;
  currentStockSKU: number;
  safetyStockSKU: number;
  shortageQtySKU: number;
  packSize: number;
};

export function SafetyStockManagement() {
  const { products, dailyStock, stockByProduct, safetyStockByProduct } = useInventory();
  const [selectedCategory, setSelectedCategory] = useState<string | "all">("all");

  const shortageByProduct = useMemo(() => {
    const list: ShortageRow[] = [];
    const categoryNames: Record<string, string> = {
      mask: "마스크",
      capsule: "캡슐세제",
      fabric: "섬유유연제",
      liquid: "액상세제",
      living: "생활용품",
    };

    // 카테고리별 2주 출고 합계
    const safetySumByCategory: Record<string, number> = {};
    for (const p of products) {
      const itemId = mapGroupToItemId(p.group);
      const safety = safetyStockByProduct[p.code] ?? 0;
      if (safety > 0) {
        safetySumByCategory[itemId] = (safetySumByCategory[itemId] ?? 0) + safety;
      }
    }

    // 현재고: 제품별 재고(stockByProduct) 우선, 없으면 당일 재고를 2주 출고 비율로 배분
    // stockByProduct = 기초재고+입고-출고 (제품별), 입출고 CSV에 품목코드 있어야 함
    for (const p of products) {
      const itemId = mapGroupToItemId(p.group);
      const productSafety = safetyStockByProduct[p.code] ?? 0;
      if (productSafety <= 0) continue;

      const productStock = stockByProduct[p.code];
      const categoryDailyStock = dailyStock[itemId] ?? 0;
      const safetySum = safetySumByCategory[itemId] ?? 0;

      // 제품별 재고(stockByProduct)가 있으면 사용, 없으면 당일 재고 배분
      const currentStock =
        productStock !== undefined
          ? Math.max(0, productStock)
          : safetySum > 0
            ? Math.round((categoryDailyStock * productSafety) / safetySum)
            : 0;

      const safetyStock = productSafety;
      const shortageQty = Math.max(0, safetyStock - currentStock);

      const packSize = (p.packSize ?? 0) > 0 ? p.packSize! : 1;
      const currentStockSKU = Math.round(currentStock / packSize);
      const safetyStockSKU = Math.round(safetyStock / packSize);
      const shortageQtySKU = Math.round(shortageQty / packSize);

      if (shortageQty > 0) {
        list.push({
          productName: p.name,
          productCode: p.code,
          categoryName: categoryNames[itemId] ?? p.group,
          categoryId: itemId,
          currentStock,
          safetyStock,
          shortageQty,
          currentStockSKU,
          safetyStockSKU,
          shortageQtySKU,
          packSize,
        });
      }
    }
    return list.sort((a, b) => b.shortageQtySKU - a.shortageQtySKU);
  }, [products, dailyStock, stockByProduct, safetyStockByProduct]);

  const groupedByCategory = useMemo(() => {
    const groups: Record<string, ShortageRow[]> = {};
    for (const item of ITEMS) {
      groups[item.id] = [];
    }
    for (const row of shortageByProduct) {
      const id = row.categoryId;
      if (!groups[id]) groups[id] = [];
      groups[id].push(row);
    }
    return groups;
  }, [shortageByProduct]);

  const filteredList =
    selectedCategory === "all"
      ? shortageByProduct
      : shortageByProduct.filter((r) => r.categoryId === selectedCategory);

  const onExportExcel = () => {
    exportShortageToExcel(shortageByProduct);
  };

  return (
    <section className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 md:rounded-xl md:p-6" style={{ backgroundColor: "rgba(245, 158, 11, 0.05)", borderColor: "rgba(245, 158, 11, 0.3)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2 md:gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-amber-400 md:text-sm">
            안전재고 미달 품목
          </h2>
          <p className="mt-0.5 hidden text-xs text-zinc-500 md:mt-1 md:block">
            SKU=총수량÷입수량
          </p>
        </div>
        <button
          type="button"
          onClick={onExportExcel}
          disabled={shortageByProduct.length === 0}
          className="shrink-0 rounded border border-amber-500/40 bg-amber-500/20 px-2 py-1.5 text-[10px] font-medium text-amber-200 hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-50 md:rounded-lg md:px-4 md:py-2.5 md:text-sm"
        >
          Excel
        </button>
      </div>

      {shortageByProduct.length === 0 ? (
        <div className="mt-3 space-y-1 py-4 text-center text-[10px] text-zinc-500 md:mt-6 md:space-y-2 md:py-8 md:text-sm">
          <p>안전재고 미달 품목이 없습니다.</p>
          <p className="hidden text-xs md:block">
            Rawdata에 입수량 컬럼을 포함하고, 당일 재고·입출고를 반영하면 SKU 기준으로 미달 품목이 표시됩니다.
          </p>
        </div>
      ) : (
        <>
          {/* 품목별 필터 탭 */}
          <div className="mt-2 flex flex-wrap gap-1 md:mt-4 md:gap-2">
            <button
              type="button"
              onClick={() => setSelectedCategory("all")}
              className={`rounded px-2 py-1 text-[10px] font-medium transition-colors md:rounded-lg md:px-3 md:py-2 md:text-sm ${
                selectedCategory === "all"
                  ? "bg-amber-500/30 text-amber-200"
                  : "bg-surface-elevated/50 text-zinc-400 hover:bg-surface-elevated"
              }`}
              style={selectedCategory === "all" ? { backgroundColor: "rgba(245, 158, 11, 0.3)" } : {}}
            >
              전체 ({shortageByProduct.length})
            </button>
            {ITEMS.map((item) => {
              const count = groupedByCategory[item.id]?.length ?? 0;
              if (count === 0) return null;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedCategory(item.id)}
                  className={`rounded px-2 py-1 text-[10px] font-medium transition-colors md:rounded-lg md:px-3 md:py-2 md:text-sm ${
                    selectedCategory === item.id
                      ? "bg-amber-500/30 text-amber-200"
                      : "bg-surface-elevated/50 text-zinc-400 hover:bg-surface-elevated"
                  }`}
                  style={selectedCategory === item.id ? { backgroundColor: "rgba(245, 158, 11, 0.3)" } : {}}
                >
                  {item.name} ({count})
                </button>
              );
            })}
          </div>

          <div className="mt-2 overflow-x-auto rounded border border-surface-border bg-surface-card md:mt-4 md:rounded-lg" style={{ backgroundColor: "#18181b", borderColor: "#27272a" }}>
            <table className="w-full min-w-[480px] text-left text-[10px] md:min-w-[640px] md:text-sm">
              <thead>
                <tr className="border-b border-surface-border bg-surface-elevated text-zinc-400" style={{ backgroundColor: "#121214", borderColor: "#27272a" }}>
                  <th className="px-2 py-1.5 font-medium md:px-4 md:py-3">상품명</th>
                  <th className="hidden px-2 py-1.5 font-medium md:table-cell md:px-4 md:py-3">품목코드</th>
                  <th className="px-2 py-1.5 font-medium md:px-4 md:py-3">품목구분</th>
                  <th className="px-2 py-1.5 font-medium text-right md:px-4 md:py-3">입수</th>
                  <th className="px-2 py-1.5 font-medium text-right md:px-4 md:py-3">현재</th>
                  <th className="px-2 py-1.5 font-medium text-right md:px-4 md:py-3">2주</th>
                  <th className="px-2 py-1.5 font-medium text-right text-amber-400 md:px-4 md:py-3">부족</th>
                </tr>
              </thead>
              <tbody>
                {filteredList.map((row, idx) => (
                  <tr
                    key={`${row.productCode}-${idx}`}
                    className="border-b border-surface-border/80 transition-colors hover:bg-surface-elevated/50"
                  >
                    <td className="px-2 py-1.5 font-medium text-white md:px-4 md:py-3">
                      {(() => {
                        const { display, full } = formatProductDisplayName(row.productName, 15);
                        return (
                          <span
                            className="inline-block max-w-[180px] truncate align-middle"
                            title={full}
                          >
                            {display}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="hidden px-2 py-1.5 text-zinc-400 md:table-cell md:px-4 md:py-3">{row.productCode}</td>
                    <td className="px-2 py-1.5 text-zinc-400 md:px-4 md:py-3">{row.categoryName}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-zinc-400 md:px-4 md:py-3">
                      {row.packSize}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-white md:px-4 md:py-3">
                      {row.currentStockSKU.toLocaleString()}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-zinc-300 md:px-4 md:py-3">
                      {row.safetyStockSKU.toLocaleString()}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-medium text-amber-400 md:px-4 md:py-3">
                      {row.shortageQtySKU.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
