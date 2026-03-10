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

      {/* 계산식 요약 테이블 */}
      <div className="mb-6 overflow-x-auto rounded-lg border border-surface-border" style={{ borderColor: "#27272a" }}>
        <table className="w-full min-w-[520px] text-left text-sm">
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
                  <td className="px-4 py-3 text-right tabular-nums text-green-400">
                    +{inQty.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-red-400">
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
      </div>

      {/* 불일치 항목 따로 표기 */}
      {discrepancies.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-amber-400">
            ⚠ 재고 불일치 (계산값 ≠ 당일 재고)
          </h3>
          <ul className="space-y-2 text-sm">
            {discrepancies.map((d) => (
              <li
                key={d.itemId}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2"
              >
                <span className="font-medium text-white">{d.name}</span>
                <span className="text-zinc-400">
                  계산: {d.calculated.toLocaleString()}개 · 당일: {d.daily.toLocaleString()}개
                </span>
                <span
                  className={
                    d.diff > 0
                      ? "font-medium text-amber-400"
                      : "font-medium text-red-400"
                  }
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
