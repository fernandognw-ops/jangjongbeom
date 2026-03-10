"use client";

import { useMemo } from "react";
import { useInventory } from "@/context/InventoryContext";
import { ITEMS } from "@/lib/types";
import type { ItemId } from "@/lib/types";

export function BaseStockAndDailyStock() {
  const {
    baseStock,
    dailyStock,
    stock,
    transactions,
  } = useInventory();

  const { inByItem, outByItem } = useMemo(() => {
    const inBy: Record<ItemId, number> = {
      mask: 0,
      capsule: 0,
      fabric: 0,
      liquid: 0,
      living: 0,
    };
    const outBy: Record<ItemId, number> = {
      mask: 0,
      capsule: 0,
      fabric: 0,
      liquid: 0,
      living: 0,
    };
    for (const tx of transactions) {
      if (tx.type === "in") {
        inBy[tx.itemId] = (inBy[tx.itemId] ?? 0) + tx.quantity;
      } else {
        outBy[tx.itemId] = (outBy[tx.itemId] ?? 0) + tx.quantity;
      }
    }
    return { inByItem: inBy, outByItem: outBy };
  }, [transactions]);

  const discrepancies = useMemo(() => {
    const list: Array<{
      itemId: ItemId;
      name: string;
      calculated: number;
      daily: number;
      diff: number;
    }> = [];
    for (const item of ITEMS) {
      const calc = stock[item.id] ?? 0;
      const daily = dailyStock[item.id] ?? 0;
      if (daily > 0) {
        const diff = calc - daily;
        if (diff !== 0) {
          list.push({
            itemId: item.id,
            name: item.name,
            calculated: calc,
            daily,
            diff,
          });
        }
      }
    }
    return list.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  }, [stock, dailyStock]);

  return (
    <section
      className="rounded-xl border border-surface-border bg-surface-card p-4 md:p-6"
      style={{
        backgroundColor: "#18181b",
        borderColor: "#27272a",
        borderRadius: "0.75rem",
      }}
    >
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-400">
        당일 재고 · 재고 불일치 분석
      </h2>
      <p className="mb-4 text-xs text-zinc-500">
        기초 재고 + 입고 - 출고 = 재고 (계산값). 당일 재고(실사)는 데이터 관리 5번에서 입력 후 비교합니다.
      </p>

      {/* PC: 테이블 / 모바일: 카드 */}
      <div className="mb-6 min-w-0 overflow-hidden rounded-lg border border-surface-border md:overflow-x-auto" style={{ borderColor: "#27272a" }}>
        <table className="hidden w-full min-w-[520px] text-left text-sm md:table">
          <thead>
            <tr className="border-b border-surface-border bg-surface-elevated text-zinc-400" style={{ backgroundColor: "#121214", borderColor: "#27272a" }}>
              <th className="px-4 py-3 font-medium">품목</th>
              <th className="px-4 py-3 text-right font-medium">기초 재고</th>
              <th className="px-4 py-3 text-right font-medium">+ 입고</th>
              <th className="px-4 py-3 text-right font-medium">- 출고</th>
              <th className="px-4 py-3 text-right font-medium">= 재고(계산)</th>
              <th className="px-4 py-3 text-right font-medium">당일 재고</th>
              <th className="px-4 py-3 text-right font-medium">차이</th>
            </tr>
          </thead>
          <tbody>
            {ITEMS.map((item) => {
              const base = baseStock[item.id] ?? 0;
              const inQty = inByItem[item.id] ?? 0;
              const outQty = outByItem[item.id] ?? 0;
              const calc = stock[item.id] ?? 0;
              const daily = dailyStock[item.id] ?? 0;
              const diff = calc - daily;
              const isMismatch = daily > 0 && diff !== 0;
              return (
                <tr
                  key={item.id}
                  className={`border-b border-surface-border/80 ${
                    isMismatch ? "bg-amber-500/10" : ""
                  }`}
                >
                  <td className="px-4 py-3 font-medium text-white">{item.name}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-zinc-300">
                    {base.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-inbound">
                    +{inQty.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-outbound">
                    -{outQty.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium text-white">
                    {calc.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-zinc-300">
                    {daily > 0 ? daily.toLocaleString() : "-"}
                  </td>
                  <td
                    className={`px-4 py-3 text-right tabular-nums font-medium ${
                      diff > 0 ? "text-amber-400" : diff < 0 ? "text-red-400" : "text-zinc-500"
                    }`}
                  >
                    {daily > 0
                      ? diff > 0
                        ? `+${diff.toLocaleString()}`
                        : diff < 0
                          ? diff.toLocaleString()
                          : "일치"
                      : "-"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* 모바일: 카드형 레이아웃 (2행 2열, 높이 일정) */}
        <div className="space-y-3 p-4 md:hidden">
          {ITEMS.map((item) => {
            const base = baseStock[item.id] ?? 0;
            const inQty = inByItem[item.id] ?? 0;
            const outQty = outByItem[item.id] ?? 0;
            const calc = stock[item.id] ?? 0;
            const daily = dailyStock[item.id] ?? 0;
            const diff = calc - daily;
            const isMismatch = daily > 0 && diff !== 0;
            const compact = (n: number) => n >= 1000000;
            return (
              <div
                key={item.id}
                className={`flex min-h-[140px] flex-col rounded-xl border p-4 mobile-no-overflow ${
                  isMismatch ? "border-amber-500/50 bg-amber-500/10" : "border-zinc-700 bg-zinc-900/50"
                }`}
              >
                <div className="mb-3 shrink-0 text-sm font-semibold text-white">{item.name}</div>
                <div className="grid min-w-0 flex-1 grid-cols-2 grid-rows-3 gap-x-4 gap-y-2 text-sm">
                  <div className="flex min-w-0 flex-col">
                    <span className="text-zinc-500">기초</span>
                    <div className={`mobile-number-large mobile-no-overflow text-white ${compact(base) ? "mobile-number-compact" : ""}`}>
                      {base.toLocaleString()}
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-col">
                    <span className="text-zinc-500">+입고</span>
                    <div className={`mobile-number-large mobile-no-overflow text-inbound ${compact(inQty) ? "mobile-number-compact" : ""}`}>
                      +{inQty.toLocaleString()}
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-col">
                    <span className="text-zinc-500">-출고</span>
                    <div className={`mobile-number-large mobile-no-overflow text-outbound ${compact(outQty) ? "mobile-number-compact" : ""}`}>
                      -{outQty.toLocaleString()}
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-col">
                    <span className="text-zinc-500">계산</span>
                    <div className={`mobile-number-large mobile-no-overflow font-bold text-white ${compact(calc) ? "mobile-number-compact" : ""}`}>
                      {calc.toLocaleString()}
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-col">
                    <span className="text-zinc-500">당일</span>
                    <div className={`mobile-number-large mobile-no-overflow text-white ${compact(daily) ? "mobile-number-compact" : ""}`}>
                      {daily > 0 ? daily.toLocaleString() : "-"}
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-col">
                    <span className="text-zinc-500">차이</span>
                    <div
                      className={`mobile-number-large mobile-no-overflow font-bold ${
                        diff > 0 ? "text-amber-400" : diff < 0 ? "text-outbound" : "text-zinc-500"
                      } ${compact(Math.abs(diff)) ? "mobile-number-compact" : ""}`}
                    >
                      {daily > 0
                        ? diff > 0
                          ? `+${diff.toLocaleString()}`
                          : diff < 0
                            ? diff.toLocaleString()
                            : "일치"
                        : "-"}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 불일치 항목 따로 표기 */}
      {discrepancies.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-amber-400 md:text-xs">
            ⚠ 재고 불일치 (계산값 ≠ 당일 재고)
          </h3>
          <ul className="space-y-3 text-sm">
            {discrepancies.map((d) => (
              <li
                key={d.itemId}
                className="flex flex-col gap-1 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 md:flex-row md:flex-wrap md:items-center md:justify-between md:gap-2"
              >
                <span className="font-semibold text-white md:text-base">{d.name}</span>
                <span className="text-zinc-300 md:text-zinc-400">
                  계산: <span className="font-medium text-white">{d.calculated.toLocaleString()}</span>개 · 당일: <span className="font-medium text-white">{d.daily.toLocaleString()}</span>개
                </span>
                <span
                  className={`text-lg font-bold md:text-base ${
                    d.diff > 0 ? "text-amber-400" : "text-outbound"
                  }`}
                >
                  {d.diff > 0 ? "+" : ""}
                  {d.diff.toLocaleString()}개 차이
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {discrepancies.length === 0 && (
        <p className="py-4 text-center text-sm text-zinc-500">
          당일 재고를 입력한 품목 중 계산값과 불일치하는 항목이 없습니다.
        </p>
      )}
    </section>
  );
}
