"use client";

import { useInventory } from "@/context/InventoryContext";
import { ITEMS } from "@/lib/types";

const MAX_ROWS = 10;

export function TransactionTable() {
  const { transactions } = useInventory();
  const displayRows = transactions.slice(0, MAX_ROWS);

  const getItemName = (id: string) => ITEMS.find((i) => i.id === id)?.name ?? id;

  if (transactions.length === 0) {
    return (
      <section className="rounded-lg border border-surface-border bg-surface-card p-3 md:rounded-xl md:p-6" style={{ backgroundColor: "#18181b", borderColor: "#27272a" }}>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400 md:mb-4 md:text-sm">
          입출고 내역 (최근 {MAX_ROWS}건)
        </h2>
        <p className="text-center text-xs text-zinc-500 md:text-base">입출고 내역이 없습니다.</p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-surface-border bg-surface-card overflow-hidden md:rounded-xl" style={{ backgroundColor: "#18181b", borderColor: "#27272a" }}>
      <h2 className="border-b border-surface-border bg-surface-elevated px-2 py-2 text-xs font-semibold uppercase tracking-wider text-zinc-400 md:px-6 md:py-3 md:text-sm" style={{ backgroundColor: "#121214", borderColor: "#27272a" }}>
        입출고 내역 (최근 {MAX_ROWS}건)
      </h2>

      {/* PC: 테이블 */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-surface-border text-zinc-400">
              <th className="px-4 py-3 font-medium md:px-6">일자</th>
              <th className="px-4 py-3 font-medium md:px-6">품목</th>
              <th className="px-4 py-3 font-medium md:px-6">구분</th>
              <th className="px-4 py-3 font-medium md:px-6 text-right">수량 (개)</th>
              <th className="px-4 py-3 font-medium md:px-6">담당자</th>
              <th className="px-4 py-3 font-medium md:px-6">비고</th>
            </tr>
          </thead>
          <tbody>
            {displayRows.map((tx) => (
              <tr
                key={tx.id}
                className="border-b border-surface-border/80 transition-colors hover:bg-surface-elevated/50"
              >
                <td className="px-4 py-3 text-white md:px-6">{tx.date}</td>
                <td className="px-4 py-3 text-white md:px-6">
                  {getItemName(tx.itemId)}
                </td>
                <td className="px-4 py-3 md:px-6">
                  <span
                    className={
                      tx.type === "in"
                        ? "font-medium text-inbound"
                        : "font-medium text-outbound"
                    }
                  >
                    {tx.type === "in" ? "입고" : "출고"}
                  </span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-white md:px-6">
                  {tx.quantity.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-zinc-300 md:px-6">{tx.person}</td>
                <td className="px-4 py-3 text-zinc-500 md:px-6">{tx.note || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 모바일: 카드형 (최소) */}
      <div className="space-y-2 p-2 md:hidden">
        {displayRows.map((tx) => (
          <div
            key={tx.id}
            className="min-w-0 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900/50 p-2"
          >
            <div className="mb-1 flex min-w-0 items-center justify-between gap-1">
              <span className="min-w-0 truncate text-xs font-semibold text-white">{getItemName(tx.itemId)}</span>
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                  tx.type === "in" ? "bg-green-500/30 text-green-400" : "bg-red-500/30 text-red-400"
                }`}
              >
                {tx.type === "in" ? "입고" : "출고"}
              </span>
            </div>
            <div
              className={`min-w-0 overflow-hidden tabular-nums font-bold text-white ${
                tx.quantity >= 1000000 ? "text-xs" : "text-sm"
              }`}
              style={{ wordBreak: "break-word" }}
            >
              {tx.quantity.toLocaleString()}개
            </div>
            <div className="mt-0.5 flex min-w-0 flex-wrap gap-x-2 overflow-hidden text-[10px] text-zinc-500">
              <span>{tx.date}</span>
              <span>{tx.person}</span>
              {tx.note && <span className="text-zinc-600">{tx.note}</span>}
            </div>
          </div>
        ))}
      </div>

      {transactions.length > MAX_ROWS && (
        <p className="border-t border-surface-border px-2 py-1 text-center text-[10px] text-zinc-500 md:px-6 md:py-2 md:text-xs">
          외 {transactions.length - MAX_ROWS}건 (총 {transactions.length}건)
        </p>
      )}
    </section>
  );
}
