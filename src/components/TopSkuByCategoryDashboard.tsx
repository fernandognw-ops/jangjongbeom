"use client";

import { useMemo, useState } from "react";
import { useInventory } from "@/context/InventoryContext";
import {
  computeTotalOutboundByProduct,
  computeAvgNDayOutboundByProduct,
  normalizeCategory,
  normalizeCode,
  STANDARD_CATEGORIES,
} from "@/lib/inventoryApi";
import type { InventoryProduct } from "@/lib/inventoryApi";

const RANKING_DAYS = 90; // 주력 품목 선정: 최근 3개월
const TOP_PRODUCT_PCT = 0.2; // 상위 20% 품목 (전체 매출의 70~80% 차지)
const MIN_MONTHLY_REVENUE = 5_000_000; // 월매출 500만원 미만 숨김
const SALES_DAYS = 30; // 일평균 출고 산출용 (안전재고·권장입고 계산)
const SAFETY_STOCK_DAYS = 14; // 2주 안전재고
const RECOMMENDED_WEEK_DAYS = 7; // 권장 입고: 1주일 물량 기준

const CATEGORY_ORDER = [...STANDARD_CATEGORIES];

export function TopSkuByCategoryDashboard() {
  const {
    useSupabaseInventory,
    inventoryProducts = [],
    inventoryOutbound = [],
    stockByProduct = {},
    dailyVelocityByProduct = {},
  } = useInventory() ?? {};

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const safeNumber = (value: unknown): number => Number(value ?? 0) || 0;
  const renderData = {
    inventoryProducts,
    inventoryOutbound,
    stockByProduct,
    dailyVelocityByProduct,
  };
  console.log("RENDER STEP", renderData);

  /** 품목별 총 출고량 (최근 3개월) - 주력 품목 선정용 */
  const totalOutbound90d = useMemo(
    () => computeTotalOutboundByProduct(inventoryOutbound, RANKING_DAYS),
    [inventoryOutbound]
  );

  /** 품목별 총 출고량 (최근 1개월) - 표시용 */
  const totalOutbound30d = useMemo(
    () => computeTotalOutboundByProduct(inventoryOutbound, SALES_DAYS),
    [inventoryOutbound]
  );

  /** 일평균 출고 (최근 30일) - 안전재고·권장입고 계산용 */
  const dailyVelByProduct = useMemo(
    () => computeAvgNDayOutboundByProduct(inventoryOutbound, SALES_DAYS),
    [inventoryOutbound]
  );

  const effectiveDailyVel = useMemo(() => {
    const ctx = dailyVelocityByProduct && Object.keys(dailyVelocityByProduct).length > 0
      ? dailyVelocityByProduct
      : dailyVelByProduct;
    return ctx;
  }, [dailyVelocityByProduct, dailyVelByProduct]);

  /** 3개월 출고량 (EA) - inventory_outbound 기반만 (fallback 제거, DB 0건이면 0) */
  const quantityFor90d = useMemo(() => {
    if ((inventoryOutbound ?? []).length === 0) return {} as Record<string, number>;
    return totalOutbound90d;
  }, [inventoryOutbound, totalOutbound90d]);

  /** 3개월 매출 (원) - 주력 품목 선정용 */
  const revenueFor90d = useMemo(() => {
    const result: Record<string, number> = {};
    for (const p of inventoryProducts) {
      const code = String(p.product_code ?? "").trim();
      const qty = quantityFor90d[code] ?? quantityFor90d[normalizeCode(code) ?? ""] ?? 0;
      const unitCost = Math.max(0, p.unit_cost ?? 0);
      if (qty > 0 && unitCost > 0) {
        result[code] = qty * unitCost;
      }
    }
    return result;
  }, [inventoryProducts, quantityFor90d]);

  /** 1개월 매출용: 최근 30일 출고량 × 단가 (표시용) - inventory_outbound 기반만 */
  const quantityFor30d = useMemo(() => {
    if ((inventoryOutbound ?? []).length === 0) return {} as Record<string, number>;
    return totalOutbound30d;
  }, [inventoryOutbound, totalOutbound30d]);

  const revenueFor30d = useMemo(() => {
    const result: Record<string, number> = {};
    for (const p of inventoryProducts) {
      const code = String(p.product_code ?? "").trim();
      const qty = quantityFor30d[code] ?? quantityFor30d[normalizeCode(code) ?? ""] ?? 0;
      const unitCost = Math.max(0, p.unit_cost ?? 0);
      if (qty > 0 && unitCost > 0) {
        result[code] = qty * unitCost;
      }
    }
    return result;
  }, [inventoryProducts, quantityFor30d]);

  /** 주력 품목: 전체 매출의 70~80%를 차지하는 상위 20% 품목 (매출 기준 정렬) */
  const topSkusByCategory = useMemo(() => {
    const allItems: { product: InventoryProduct; revenue: number; quantity: number; cat: string }[] = [];
    for (const p of inventoryProducts) {
      const raw = String(p.category ?? p.group_name ?? "").trim();
      const pCat = normalizeCategory(raw) || raw;
      if (!(CATEGORY_ORDER as readonly string[]).includes(pCat)) continue;

      const code = String(p.product_code ?? "").trim();
      const revenue = revenueFor90d[code] ?? revenueFor90d[normalizeCode(code) ?? ""] ?? 0;
      const quantity = quantityFor90d[code] ?? quantityFor90d[normalizeCode(code) ?? ""] ?? 0;
      if (revenue <= 0) continue;

      allItems.push({ product: p, revenue, quantity, cat: pCat });
    }

    if (allItems.length === 0) {
      const empty: Record<string, { product: InventoryProduct; revenue: number; quantity: number; rank: number }[]> = {};
      for (const cat of CATEGORY_ORDER) empty[cat] = [];
      return empty;
    }

    allItems.sort((a, b) => b.revenue - a.revenue);
    const takeCount = Math.max(1, Math.ceil(allItems.length * TOP_PRODUCT_PCT));
    const keyItems = allItems.slice(0, takeCount);

    const byCat: Record<string, { product: InventoryProduct; revenue: number; quantity: number; rank: number }[]> = {};
    for (const cat of CATEGORY_ORDER) byCat[cat] = [];
    keyItems.forEach((x, i) => {
      byCat[x.cat].push({ product: x.product, revenue: x.revenue, quantity: x.quantity, rank: i + 1 });
    });
    return byCat;
  }, [inventoryProducts, revenueFor90d, quantityFor90d]);

  /** 1주일 판매량 (권장 입고 계산용) - inventory_outbound 기반만 */
  const oneWeekSalesByProduct = useMemo(() => {
    if ((inventoryOutbound ?? []).length === 0) return {} as Record<string, number>;
    return computeTotalOutboundByProduct(inventoryOutbound, RECOMMENDED_WEEK_DAYS);
  }, [inventoryOutbound]);

  /** 테이블용 행 데이터: 상위 SKU + 재고/입고 정보 */
  const tableRows = useMemo(() => {
    const rows: Array<{
      cat: string;
      product: InventoryProduct;
      revenue: number;
      revenue1m: number; // 1개월 매출 (표시용)
      quantity: number;
      rank: number;
      stock: number;
      dailyVel: number;
      safety2w: number;
      isBelow2w: boolean;
      daysOfStock: number | null; // 잔여 재고 일수
      recommendedOrder: number;
      dueDate: string | null;
    }> = [];
    for (const cat of CATEGORY_ORDER) {
      for (const { product, revenue, quantity, rank } of topSkusByCategory[cat] ?? []) {
        const code = String(product.product_code).trim();
        const revenue1m = revenueFor30d[code] ?? revenueFor30d[normalizeCode(code) ?? ""] ?? 0;
        const stock = Math.max(0, stockByProduct[code] ?? stockByProduct[normalizeCode(code) ?? ""] ?? 0);
        const dailyVel = effectiveDailyVel[code] ?? effectiveDailyVel[normalizeCode(code) ?? ""] ?? 0;
        const safety2w = dailyVel > 0 ? dailyVel * SAFETY_STOCK_DAYS : 0;
        const shortfall = Math.max(0, safety2w - stock);
        const isBelow2w = safety2w > 0 && stock < safety2w;
        const oneWeekSales = oneWeekSalesByProduct[code] ?? oneWeekSalesByProduct[normalizeCode(code) ?? ""] ?? dailyVel * RECOMMENDED_WEEK_DAYS;
        // 권장 입고 = 1주일 물량 + 부족분 (부족분에서 차감 = 부족분을 채우고 1주일 판매 물량 확보)
        const recommendedOrder = isBelow2w ? Math.ceil(oneWeekSales + shortfall) : 0;
        const daysOfStock = dailyVel > 0 && stock > 0 ? stock / dailyVel : (stock <= 0 ? 0 : null);
        const dueDate = isBelow2w && daysOfStock != null
          ? (() => {
              const d = new Date();
              d.setDate(d.getDate() + Math.floor(daysOfStock));
              return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
            })()
          : null;
        rows.push({
          cat,
          product,
          revenue,
          revenue1m,
          quantity,
          rank,
          stock,
          dailyVel,
          safety2w,
          isBelow2w,
          daysOfStock,
          recommendedOrder,
          dueDate,
        });
      }
    }
    return rows;
  }, [
    topSkusByCategory,
    stockByProduct,
    effectiveDailyVel,
    oneWeekSalesByProduct,
    revenueFor30d,
  ]);

  const hasAnyTopSkus = CATEGORY_ORDER.some((cat) => (topSkusByCategory[cat] ?? []).length > 0);

  return (
    <div className="mt-8 min-h-[12rem] min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-card md:mt-10 md:p-6">
      <div className="mb-4">
        <h2 className="text-lg font-bold text-slate-800 md:text-xl">
          카테고리별 주력 SKU 재고 관리
        </h2>
        {!useSupabaseInventory && (
          <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            데이터 없음 (로컬 모드). 집계값은 0으로 표시됩니다.
          </div>
        )}
        <p className="mt-1 text-xs text-slate-500">
          {(inventoryOutbound ?? []).length > 0
            ? "최근 3개월 전체 매출의 70~80%를 차지하는 상위 20% 품목"
            : "일평균 출고 × 90일 × 단가 (최근 30일 출고 기반 추정)"}
          {" "}· 월매출 500만원 이상 · 2주 안전재고 미달 품목만 표시
        </p>
        <div className="mt-2 text-xs text-slate-500">
          {(inventoryProducts ?? []).length > 0
            ? `품목 ${safeNumber(inventoryProducts?.length).toLocaleString()}건 기준`
            : "품목 데이터 없음 (0건)"}
          {" · "}
          {(inventoryOutbound ?? []).length > 0
            ? `출고 ${safeNumber(inventoryOutbound?.length).toLocaleString()}건 기준`
            : "출고 데이터 없음 (0건)"}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSelectedCategory(null)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              selectedCategory === null
                ? "bg-indigo-500 text-white"
                : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            전체
          </button>
          {CATEGORY_ORDER.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                selectedCategory === cat
                  ? "bg-indigo-500 text-white"
                  : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {!hasAnyTopSkus ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 py-12 text-center text-slate-500">
          최근 3개월 출고 이력이 있는 품목이 없습니다. 출고 데이터를 확인해 주세요.
        </div>
      ) : (() => {
        const shortageRows = tableRows
          .filter((r) => r.isBelow2w)
          .filter((r) => r.revenue1m >= MIN_MONTHLY_REVENUE)
          .filter((r) => selectedCategory == null || r.cat === selectedCategory)
          .sort((a, b) => b.revenue1m - a.revenue1m);
        return shortageRows.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 py-12 text-center text-slate-500">
            {selectedCategory
              ? `${selectedCategory} 카테고리의 2주 안전재고 미달 품목이 없습니다. (월매출 500만원 이상 기준)`
              : "2주 안전재고 미달 품목이 없습니다. (월매출 500만원 이상 기준)"}
          </div>
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr>
                <th className="border border-slate-200 bg-slate-50 px-2 py-2 text-center text-xs font-medium text-slate-600">
                  순위
                </th>
                <th className="border border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs font-medium text-slate-600">
                  품목(SKU)
                </th>
                <th className="border border-slate-200 bg-slate-50 px-3 py-2 text-right text-xs font-medium text-slate-600" title="최근 30일 출고량 × 단가">
                  1개월 매출 (30일 출고)
                </th>
                <th className="border border-slate-200 bg-slate-50 px-3 py-2 text-right text-xs font-medium text-slate-600">
                  현재 재고
                </th>
                <th className="border border-slate-200 bg-slate-50 px-2 py-2 text-center text-xs font-medium text-slate-600">
                  2주 미달 / 잔여일수
                </th>
                <th className="border border-slate-200 bg-slate-50 px-3 py-2 text-right text-xs font-medium text-slate-600">
                  권장 입고
                </th>
                <th className="border border-slate-200 bg-slate-50 px-3 py-2 text-right text-xs font-medium text-slate-600">
                  입고 기한
                </th>
              </tr>
            </thead>
            <tbody>
              {shortageRows.map((r, idx) => (
                <tr
                  key={`${r.cat}-${r.product.product_code}`}
                  className={`hover:bg-slate-50 ${
                    r.daysOfStock != null && r.daysOfStock < 7
                      ? "border-l-4 border-l-rose-500 bg-rose-100"
                      : ""
                  }`}
                >
                  <td className="border border-slate-200 px-2 py-2 text-center tabular-nums text-slate-600">
                    {idx + 1}
                  </td>
                  <td className="border border-slate-200 px-3 py-2 text-slate-700" title={r.product.product_code}>
                    {String(r.product.product_name ?? r.product.product_code ?? "").trim() || r.product.product_code}
                  </td>
                  <td className="border border-slate-200 px-3 py-2 text-right tabular-nums font-medium text-slate-800">
                    {safeNumber(Math.round(r.revenue1m)).toLocaleString()}원
                  </td>
                  <td className="border border-slate-200 px-3 py-2 text-right tabular-nums text-slate-700">
                    {safeNumber(Math.round(r.stock)).toLocaleString()}
                  </td>
                  <td className="border border-slate-200 px-2 py-2 text-center">
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                      미달
                    </span>
                    {r.daysOfStock != null && (
                      <span
                        className={`ml-1 text-sm font-bold ${
                          r.daysOfStock < 7
                            ? "rounded bg-rose-500 px-2 py-0.5 text-white"
                            : "text-slate-600"
                        }`}
                      >
                        {r.daysOfStock <= 0 ? "0일" : `${r.daysOfStock.toFixed(1)}일`}
                        {r.daysOfStock < 7 && " 긴급"}
                      </span>
                    )}
                  </td>
                  <td className="border border-slate-200 px-3 py-2 text-right tabular-nums text-indigo-600">
                    {r.recommendedOrder > 0 ? safeNumber(Math.round(r.recommendedOrder)).toLocaleString() : "-"}
                  </td>
                  <td className="border border-slate-200 px-3 py-2 text-right tabular-nums">
                    {r.dueDate ? (
                      <span className="font-medium text-rose-600">{r.dueDate}</span>
                    ) : (
                      <span className="text-slate-400">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        );
      })()}
    </div>
  );
}
